// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import sharp from 'sharp';
import {
  ImageInput,
  PatchModeOptions,
  ProcessedImage,
  PatchMetadata,
  DetailLevel,
  ImageDimensions,
} from './types.js';
import {
  resolveImageBuffer,
  getImageDimensions,
  calculatePatchCount,
  isPhotographic,
} from './utils.js';

const PATCH_TOKEN_MULTIPLIER = 1.62;

interface PatchBudget {
  maxPatches: number;
  maxDimension: number;
}

const PATCH_BUDGETS: Record<DetailLevel, PatchBudget | 'fixed'> = {
  low: 'fixed',
  high: { maxPatches: 2500, maxDimension: 2048 },
  original: { maxPatches: 10000, maxDimension: 6000 },
};

function fitToPatchBudget(dimensions: ImageDimensions, budget: PatchBudget): ImageDimensions {
  let { width, height } = dimensions;

  const maxDim = Math.max(width, height);
  if (maxDim > budget.maxDimension) {
    const scale = budget.maxDimension / maxDim;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  let patches = calculatePatchCount(width, height);
  while (patches > budget.maxPatches) {
    const scale = Math.sqrt(budget.maxPatches / patches) * 0.99;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    patches = calculatePatchCount(width, height);
  }

  return { width, height };
}

export async function preprocessPatchMode(
  input: ImageInput,
  options: PatchModeOptions
): Promise<ProcessedImage> {
  const { detail, outputFormat = 'auto', jpegQuality = 85, fetch: fetchOptions } = options;

  const buffer = await resolveImageBuffer(input, fetchOptions);
  const originalDimensions = await getImageDimensions(buffer);

  let targetDimensions: ImageDimensions;
  const budget = PATCH_BUDGETS[detail];

  if (budget === 'fixed') {
    targetDimensions = { width: 512, height: 512 };
  } else {
    targetDimensions = fitToPatchBudget(originalDimensions, budget);
  }

  const needsResize =
    targetDimensions.width !== originalDimensions.width ||
    targetDimensions.height !== originalDimensions.height;

  let pipeline = sharp(buffer).rotate();

  if (needsResize) {
    pipeline = pipeline.resize(targetDimensions.width, targetDimensions.height, {
      fit: detail === 'low' ? 'cover' : 'inside',
      withoutEnlargement: detail !== 'low',
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
  const patchCount = calculatePatchCount(finalDimensions.width, finalDimensions.height);

  const metadata: PatchMetadata = {
    originalDimensions,
    resizedDimensions: finalDimensions,
    patchCount,
    estimatedTokens: Math.round(patchCount * PATCH_TOKEN_MULTIPLIER),
  };

  return {
    base64: outputBuffer.toString('base64'),
    mimeType: useJpeg ? 'image/jpeg' : 'image/png',
    metadata,
  };
}
