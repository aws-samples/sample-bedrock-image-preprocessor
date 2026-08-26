// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { ImageInput, PreprocessOptions, ProcessedImage } from './types.js';
import { preprocessPatchMode } from './patch-mode.js';
import { preprocessTileMode } from './tile-mode.js';

export async function preprocessImages(
  images: ImageInput[],
  options: PreprocessOptions
): Promise<ProcessedImage[]> {
  const { mode, detail = 'high', maxTotalTokens, outputFormat, jpegQuality, fetch: fetchOptions } = options;

  if (images.length === 0) return [];

  if (mode === 'patch') {
    const results = await Promise.all(
      images.map((img) =>
        preprocessPatchMode(img, { detail, outputFormat, jpegQuality, fetch: fetchOptions })
      )
    );

    if (maxTotalTokens) {
      return redistributeTokenBudget(images, results, maxTotalTokens, options);
    }

    return results;
  }

  const perImageBudget = maxTotalTokens
    ? Math.floor(maxTotalTokens / images.length)
    : undefined;

  const results = await Promise.all(
    images.map((img) =>
      preprocessTileMode(img, {
        maxTokenBudget: perImageBudget,
        outputFormat,
        jpegQuality,
        fetch: fetchOptions,
      })
    )
  );

  if (maxTotalTokens) {
    const totalTokens = results.reduce((sum, r) => sum + r.metadata.estimatedTokens, 0);
    if (totalTokens > maxTotalTokens) {
      return redistributeTokenBudget(images, results, maxTotalTokens, options);
    }
  }

  return results;
}

async function redistributeTokenBudget(
  images: ImageInput[],
  initialResults: ProcessedImage[],
  maxTotalTokens: number,
  options: PreprocessOptions
): Promise<ProcessedImage[]> {
  const totalTokens = initialResults.reduce((sum, r) => sum + r.metadata.estimatedTokens, 0);

  if (totalTokens <= maxTotalTokens) {
    return initialResults;
  }

  const reductionFactor = maxTotalTokens / totalTokens;
  const { mode, detail = 'high', outputFormat, jpegQuality, fetch: fetchOptions } = options;

  const results = await Promise.all(
    images.map((img, i) => {
      const targetTokens = Math.floor(
        initialResults[i].metadata.estimatedTokens * reductionFactor
      );

      if (mode === 'tile') {
        return preprocessTileMode(img, {
          maxTokenBudget: targetTokens,
          outputFormat,
          jpegQuality,
          fetch: fetchOptions,
        });
      }

      const lowerDetail = reducePatchDetail(detail, reductionFactor);
      return preprocessPatchMode(img, {
        detail: lowerDetail,
        outputFormat,
        jpegQuality,
        fetch: fetchOptions,
      });
    })
  );

  return results;
}

function reducePatchDetail(
  current: 'low' | 'high' | 'original',
  factor: number
): 'low' | 'high' | 'original' {
  if (factor < 0.3) return 'low';
  if (current === 'original' && factor < 0.7) return 'high';
  return current;
}
