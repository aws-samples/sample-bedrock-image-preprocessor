// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { PreprocessMode, DetailLevel, ProcessedImage, RemoteFetchOptions } from './types.js';
import { preprocessPatchMode } from './patch-mode.js';
import { preprocessTileMode } from './tile-mode.js';

export interface BedrockImageMiddlewareOptions {
  mode: PreprocessMode;
  detail?: DetailLevel;
  maxTokensPerImage?: number;
  jpegQuality?: number;

  /**
   * Restrictions for image parts that are URLs rather than inline data.
   *
   * This middleware sits in a model call path, so its image parts often come
   * from user- or model-authored messages — exactly the untrusted input that
   * makes an unguarded fetch an SSRF risk. Set at least
   * `{ blockPrivateNetworks: true }` unless every message is fully trusted.
   */
  fetch?: RemoteFetchOptions;
}

interface ImageContentPart {
  type: 'image';
  image: string | URL;
  mimeType?: string;
}

interface TextContentPart {
  type: 'text';
  text: string;
}

type ContentPart = ImageContentPart | TextContentPart | { type: string; [key: string]: unknown };

interface Message {
  role: string;
  content: string | ContentPart[];
}

export function createImagePreprocessor(options: BedrockImageMiddlewareOptions) {
  const {
    mode,
    detail = 'high',
    maxTokensPerImage,
    jpegQuality = 85,
    fetch: fetchOptions,
  } = options;

  return {
    transformParams: async (params: { messages?: Message[]; [key: string]: unknown }) => {
      if (!params.messages) return params;

      const transformedMessages = await Promise.all(
        params.messages.map(async (message) => {
          if (typeof message.content === 'string') return message;
          if (!Array.isArray(message.content)) return message;

          const transformedContent = await Promise.all(
            message.content.map(async (part) => {
              if (part.type !== 'image') return part;
              const imagePart = part as ImageContentPart;
              const processed = await processImagePart(imagePart, {
                mode,
                detail,
                maxTokens: maxTokensPerImage,
                jpegQuality,
                fetchOptions,
              });
              return {
                type: 'image' as const,
                image: `data:${processed.mimeType};base64,${processed.base64}`,
              };
            })
          );

          return { ...message, content: transformedContent };
        })
      );

      return { ...params, messages: transformedMessages };
    },
  };
}

async function processImagePart(
  part: ImageContentPart,
  config: {
    mode: PreprocessMode;
    detail: DetailLevel;
    maxTokens: number | undefined;
    jpegQuality: number;
    fetchOptions: RemoteFetchOptions | undefined;
  }
): Promise<ProcessedImage> {
  const { mode, detail, maxTokens, jpegQuality, fetchOptions } = config;
  let input: Buffer | string;

  if (typeof part.image === 'string') {
    input = part.image;
  } else if (part.image instanceof URL) {
    input = part.image.toString();
  } else {
    input = part.image;
  }

  if (mode === 'patch') {
    return preprocessPatchMode(input, { detail, jpegQuality, fetch: fetchOptions });
  }

  return preprocessTileMode(input, {
    maxTokenBudget: maxTokens,
    jpegQuality,
    fetch: fetchOptions,
  });
}

export function wrapLanguageModel(
  model: unknown,
  options: BedrockImageMiddlewareOptions
) {
  const preprocessor = createImagePreprocessor(options);

  return new Proxy(model as object, {
    get(target, prop, receiver) {
      if (prop === 'doGenerate' || prop === 'doStream') {
        const originalMethod = Reflect.get(target, prop, receiver) as Function;
        return async function (params: { messages?: Message[]; [key: string]: unknown }) {
          const transformedParams = await preprocessor.transformParams(params);
          return originalMethod.call(target, transformedParams);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
