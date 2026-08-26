// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import {
  BedrockClient,
  ListFoundationModelsCommand,
} from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ImageFormat,
} from '@aws-sdk/client-bedrock-runtime';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';

const region = process.env.AWS_REGION || 'us-east-1';

// OpenAI-compatible Chat Completions endpoint for Amazon Bedrock.
// See: https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html
//
// The base URL and path are configurable so this sample works across the
// documented options:
//   - bedrock-mantle: https://bedrock-mantle.{region}.api.aws  (path /v1)
//   - bedrock-runtime: https://bedrock-runtime.{region}.amazonaws.com (path /v1 or /openai/v1)
const OPENAI_ENDPOINT =
  process.env.BEDROCK_OPENAI_ENDPOINT ||
  process.env.BEDROCK_MANTLE_ENDPOINT ||
  `https://bedrock-mantle.${region}.api.aws`;
// Path prefix for the OpenAI-compatible API. Defaults to the value this sample
// was tested against; set BEDROCK_OPENAI_BASE_PATH=/v1 to match the docs.
const OPENAI_BASE_PATH = (process.env.BEDROCK_OPENAI_BASE_PATH || '/openai/v1').replace(/\/$/, '');

const bedrockClient = new BedrockClient({ region });
const runtimeClient = new BedrockRuntimeClient({ region });

export interface VisionModel {
  modelId: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  inputModalities: string[];
}

async function listOpenAICompatibleModels(): Promise<VisionModel[]> {
  try {
    const url = new URL(`${OPENAI_ENDPOINT}${OPENAI_BASE_PATH}/models`);
    const request = new HttpRequest({
      method: 'GET',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      headers: { host: url.hostname },
    });

    const credentials = fromNodeProviderChain();
    const signer = new SignatureV4({ service: 'bedrock', region, credentials, sha256: Sha256 });
    const signed = await signer.sign(request);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: signed.headers as Record<string, string>,
    });

    if (!response.ok) return [];

    const data = await response.json() as { data?: { id: string; owned_by?: string }[] };
    const visionKeywords = ['gpt-5', 'gpt-4o', 'gpt-4-vision'];

    return (data.data ?? [])
      .filter((m) => visionKeywords.some((kw) => m.id.includes(kw)))
      .map((m) => ({
        modelId: m.id,
        name: m.id.toUpperCase().replace(/-/g, ' ').replace(/\./g, '.'),
        provider: 'OpenAI',
        contextWindow: 128000,
        inputModalities: ['TEXT', 'IMAGE'],
      }));
  } catch {
    return [];
  }
}

export async function listVisionModels(): Promise<VisionModel[]> {
  const command = new ListFoundationModelsCommand({});

  const response = await bedrockClient.send(command);
  const models = response.modelSummaries ?? [];

  const visionModels = models.filter((m) =>
    m.modelId &&
    m.inputModalities?.includes('IMAGE') &&
    m.inputModalities?.includes('TEXT') &&
    m.outputModalities?.includes('TEXT')
  );

  const seen = new Set<string>();
  const converseModels = visionModels
    .filter((m) => {
      const baseId = m.modelId!.replace(/:\d+k$|:mm$/, '');
      if (seen.has(baseId)) return false;
      seen.add(baseId);
      return true;
    })
    .map((m) => ({
      modelId: `us.${m.modelId!}`,
      name: m.modelName ?? m.modelId!,
      provider: m.providerName ?? 'Unknown',
      contextWindow: null,
      inputModalities: m.inputModalities ?? [],
    }))
    .sort((a, b) => {
      const providerCmp = a.provider.localeCompare(b.provider);
      if (providerCmp !== 0) return providerCmp;
      return a.name.localeCompare(b.name);
    });

  const openAICompatibleModels = await listOpenAICompatibleModels();
  return [...openAICompatibleModels, ...converseModels];
}

export interface InferenceResult {
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface InferenceError {
  /**
   * Machine-readable classification. `context_length_exceeded` is the one the
   * client reacts to, since demonstrating that failure is the point of the
   * "send without preprocessing" comparison.
   */
  code: string;
  /**
   * Human-readable summary that is safe to show a browser. Upstream error
   * bodies and SDK exception messages can carry request IDs, model ARNs, and
   * account detail, so they are logged rather than returned; see `logUpstream`.
   */
  message: string;
  totalTokensAttempted?: number;
}

/**
 * Record the full upstream detail server-side. In the deployed stack this lands
 * in the function's CloudWatch log group, where an operator can correlate it
 * with the generic message the client received.
 *
 * `context` is passed as an argument rather than interpolated into the first
 * one: it embeds a client-supplied model ID, and only the first argument is
 * treated as a format string, so a `%s` in that ID cannot forge a log line.
 */
function logUpstream(context: string, detail: unknown): void {
  console.error('[bedrock]', context, detail);
}

function getImageFormat(mimeType: string): ImageFormat {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'jpeg';
}

function isOpenAICompatibleModel(modelId: string): boolean {
  return modelId.startsWith('gpt-');
}

export async function invokeModel(
  modelId: string,
  images: { base64: string; mimeType: string }[],
  prompt: string
): Promise<{ result: InferenceResult | null; error: InferenceError | null }> {
  if (isOpenAICompatibleModel(modelId)) {
    return invokeOpenAICompatibleModel(modelId, images, prompt);
  }
  return invokeConverseModel(modelId, images, prompt);
}

async function invokeOpenAICompatibleModel(
  modelId: string,
  images: { base64: string; mimeType: string }[],
  prompt: string
): Promise<{ result: InferenceResult | null; error: InferenceError | null }> {
  const start = Date.now();

  const imageContent = images.map((img) => ({
    type: 'image_url' as const,
    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
  }));

  const body = JSON.stringify({
    model: modelId,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          ...imageContent,
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  try {
    const url = new URL(`${OPENAI_ENDPOINT}${OPENAI_BASE_PATH}/chat/completions`);

    const request = new HttpRequest({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        host: url.hostname,
      },
      body,
    });

    const credentials = fromNodeProviderChain();
    const signer = new SignatureV4({
      service: 'bedrock',
      region,
      credentials,
      sha256: Sha256,
    });

    const signed = await signer.sign(request);

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: signed.headers as Record<string, string>,
      body,
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errorBody = await response.text();
      logUpstream(`chat/completions returned ${response.status} for ${modelId}`, errorBody);

      const isOverflow =
        errorBody.includes('context_length_exceeded') ||
        errorBody.includes('maximum context length') ||
        errorBody.includes('token');

      return {
        result: null,
        error: {
          code: isOverflow ? 'context_length_exceeded' : `http_${response.status}`,
          message: isOverflow
            ? 'The request exceeded the model context window.'
            : `The model endpoint returned HTTP ${response.status}. See the server log for detail.`,
        },
      };
    }

    const data = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    };

    return {
      result: {
        response: data.choices?.[0]?.message?.content ?? '',
        model: data.model ?? modelId,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs,
      },
      error: null,
    };
  } catch (err: unknown) {
    logUpstream(`chat/completions call failed for ${modelId}`, err);
    return {
      result: null,
      error: {
        code: 'openai_endpoint_error',
        message: 'Failed to call the OpenAI-compatible endpoint. See the server log for detail.',
      },
    };
  }
}

async function invokeConverseModel(
  modelId: string,
  images: { base64: string; mimeType: string }[],
  prompt: string
): Promise<{ result: InferenceResult | null; error: InferenceError | null }> {
  const imageContent: ContentBlock[] = images.map((img) => ({
    image: {
      format: getImageFormat(img.mimeType),
      source: { bytes: Buffer.from(img.base64, 'base64') },
    },
  }));

  const content: ContentBlock[] = [
    ...imageContent,
    { text: prompt },
  ];

  const start = Date.now();

  try {
    const command = new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content }],
      inferenceConfig: { maxTokens: 1024 },
    });

    const response = await runtimeClient.send(command);
    const latencyMs = Date.now() - start;

    const outputText =
      response.output?.message?.content
        ?.map((block) => ('text' in block ? block.text : ''))
        .join('') ?? '';

    return {
      result: {
        response: outputText,
        model: modelId,
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
        latencyMs,
      },
      error: null,
    };
  } catch (err: unknown) {
    logUpstream(`Converse call failed for ${modelId}`, err);
    const error = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };

    const isOverflow =
      error.name === 'ValidationException' ||
      error.message?.includes('token') ||
      error.message?.includes('too long') ||
      error.message?.includes('exceeds');

    // The exception name is a documented part of the Bedrock API and carries no
    // account detail, so it is safe to name; the message itself is not.
    return {
      result: null,
      error: {
        code: isOverflow ? 'context_length_exceeded' : (error.name ?? 'unknown_error'),
        message: isOverflow
          ? 'The request exceeded the model context window.'
          : `Inference failed (${error.name ?? 'unknown error'}). See the server log for detail.`,
      },
    };
  }
}
