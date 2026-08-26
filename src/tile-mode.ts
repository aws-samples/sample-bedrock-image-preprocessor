// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import sharp from 'sharp';
import {
  ImageInput,
  TileModeOptions,
  ProcessedImage,
  TileMetadata,
  ImageDimensions,
} from './types.js';
import {
  resolveImageBuffer,
  getImageDimensions,
  isPhotographic,
} from './utils.js';

const ANTHROPIC_MAX_LONG_EDGE = 1568;
const ANTHROPIC_MAX_SHORT_EDGE = 768;
const TILE_SIZE = 512;

function calculateAnthropicTokens(width: number, height: number): number {
  return Math.round((width * height) / 750);
}

function calculateTileCount(width: number, height: number): number {
  return Math.ceil(width / TILE_SIZE) * Math.ceil(height / TILE_SIZE);
}

function fitToAnthropicConstraints(dimensions: ImageDimensions): ImageDimensions {
  let { width, height } = dimensions;

  const maxDim = Math.max(width, height);
  if (maxDim > 2048) {
    const scale = 2048 / maxDim;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const longEdge = Math.max(width, height);
  if (longEdge > ANTHROPIC_MAX_LONG_EDGE) {
    const scale = ANTHROPIC_MAX_LONG_EDGE / longEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const shortEdge = Math.min(width, height);
  if (shortEdge > ANTHROPIC_MAX_SHORT_EDGE) {
    const scale = ANTHROPIC_MAX_SHORT_EDGE / shortEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return { width, height };
}

function fitToTokenBudget(dimensions: ImageDimensions, maxTokens: number): ImageDimensions {
  let { width, height } = dimensions;
  const currentTokens = calculateAnthropicTokens(width, height);

  if (currentTokens <= maxTokens) {
    return { width, height };
  }

  const scale = Math.sqrt(maxTokens / currentTokens);
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  return { width, height };
}

export async function preprocessTileMode(
  input: ImageInput,
  options: TileModeOptions = {}
): Promise<ProcessedImage> {
  const { maxTokenBudget, outputFormat = 'auto', jpegQuality = 85, fetch: fetchOptions } = options;

  const buffer = await resolveImageBuffer(input, fetchOptions);
  const originalDimensions = await getImageDimensions(buffer);

  let targetDimensions = fitToAnthropicConstraints(originalDimensions);

  if (maxTokenBudget) {
    targetDimensions = fitToTokenBudget(targetDimensions, maxTokenBudget);
  }

  const needsResize =
    targetDimensions.width !== originalDimensions.width ||
    targetDimensions.height !== originalDimensions.height;

  let pipeline = sharp(buffer).rotate();

  if (needsResize) {
    pipeline = pipeline.resize(targetDimensions.width, targetDimensions.height, {
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let useJpeg: boolean;
  if (outputFormat === 'auto') {
    useJpeg = await isPhotographic(buffer);
  } else {
    useJpeg = outputFormat === 'jpeg';
  }

  let outputBuffer: Buffer;
  if (useJpeg) {
    outputBuffer = await pipeline.jpeg({ quality: jpegQuality }).toBuffer();
  } else {
    outputBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
  }

  const finalDimensions = await getImageDimensions(outputBuffer);
  const tileCount = calculateTileCount(finalDimensions.width, finalDimensions.height);

  const metadata: TileMetadata = {
    originalDimensions,
    resizedDimensions: finalDimensions,
    tileCount,
    estimatedTokens: calculateAnthropicTokens(finalDimensions.width, finalDimensions.height),
  };

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: useJpeg ? 'image/jpeg' : 'image/png',
    metadata,
  };
}
