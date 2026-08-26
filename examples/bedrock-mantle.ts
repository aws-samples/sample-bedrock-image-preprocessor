// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
/**
 * Example: preprocessing images with the AI SDK + the Amazon Bedrock
 * OpenAI-compatible Chat Completions endpoint (bedrock-mantle).
 *
 * This shows how to preprocess images before sending them to OpenAI models
 * on Amazon Bedrock. This sample is not published to a package registry —
 * copy the `src/` module into your project and import it directly, as below.
 *
 * Endpoint reference:
 * https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html
 */
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { preprocessImages, createImagePreprocessor } from '../src/index.js';

// --- Option 1: Manual batch preprocessing ---

async function manualPreprocessing() {
  const bedrock = createOpenAI({
    baseURL: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
    apiKey: 'bedrock',
  });

  // Customer's images (10-15 per request)
  const imageUrls = [
    'https://example.com/screenshot1.png',
    'https://example.com/photo1.jpg',
    'https://example.com/diagram1.png',
    // ... up to 15 images
  ];

  // Preprocess: reduce from ~30K tokens/image to ~2K tokens/image
  const processed = await preprocessImages(imageUrls, {
    mode: 'patch', // Use patch mode for OpenAI models
    detail: 'high',
    maxTotalTokens: 30000, // Leave room for text in 128K context
  });

  console.log('Token usage summary:');
  processed.forEach((img, i) => {
    console.log(
      `  Image ${i + 1}: ${img.metadata.originalDimensions.width}x${img.metadata.originalDimensions.height}` +
      ` → ${img.metadata.resizedDimensions.width}x${img.metadata.resizedDimensions.height}` +
      ` (${img.metadata.estimatedTokens} tokens)`
    );
  });
  const totalTokens = processed.reduce((sum, r) => sum + r.metadata.estimatedTokens, 0);
  console.log(`  Total: ${totalTokens} tokens (was ~${imageUrls.length * 30000} without preprocessing)`);

  // Build message with preprocessed images
  const content = processed.map((img) => ({
    type: 'image' as const,
    image: `data:${img.mimeType};base64,${img.base64}`,
  }));

  const result = await generateText({
    model: bedrock('gpt-4o'),
    messages: [
      {
        role: 'user',
        content: [
          ...content,
          { type: 'text', text: 'Analyze these images and summarize what you see.' },
        ],
      },
    ],
  });

  console.log(result.text);
}

// --- Option 2: Middleware approach (auto-preprocesses images) ---

async function middlewareApproach() {
  const bedrock = createOpenAI({
    baseURL: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
    apiKey: 'bedrock',
  });

  const preprocessor = createImagePreprocessor({
    mode: 'patch',
    detail: 'high',
    maxTokensPerImage: 2000,
  });

  // The preprocessor transforms params before they reach the model
  const params = {
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: 'https://example.com/large-screenshot.png' },
          { type: 'image', image: 'https://example.com/photo.jpg' },
          { type: 'text', text: 'What do these images show?' },
        ],
      },
    ],
  };

  const transformed = await preprocessor.transformParams(params);
  console.log('Images preprocessed and ready for Bedrock');
}

// --- Option 3: Using tile mode for Anthropic models on Bedrock Runtime ---

async function anthropicBedrockRuntime() {
  const imageBuffers: Buffer[] = []; // Your image buffers here

  const processed = await preprocessImages(imageBuffers, {
    mode: 'tile', // Use tile mode for Anthropic models
    maxTotalTokens: 30000,
  });

  console.log('Token usage (Anthropic tile mode):');
  processed.forEach((img, i) => {
    console.log(
      `  Image ${i + 1}: ${img.metadata.estimatedTokens} tokens`
    );
  });
}
