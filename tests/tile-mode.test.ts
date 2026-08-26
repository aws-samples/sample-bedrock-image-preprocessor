// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, it, expect } from 'vitest';
import { preprocessTileMode } from '../src/tile-mode.js';
import { createTestImage } from './helpers.js';

describe('preprocessTileMode', () => {
  it('constrains longest edge to 1568px', async () => {
    const image = await createTestImage(4000, 3000);
    const result = await preprocessTileMode(image);

    const { width, height } = result.metadata.resizedDimensions;
    expect(Math.max(width, height)).toBeLessThanOrEqual(1568);
  });

  it('preserves aspect ratio', async () => {
    const image = await createTestImage(4000, 2000);
    const result = await preprocessTileMode(image);

    const { width, height } = result.metadata.resizedDimensions;
    const ratio = width / height;
    expect(ratio).toBeCloseTo(2.0, 0);
  });

  it('keeps small images unchanged', async () => {
    const image = await createTestImage(400, 300);
    const result = await preprocessTileMode(image);

    expect(result.metadata.resizedDimensions.width).toBe(400);
    expect(result.metadata.resizedDimensions.height).toBe(300);
  });

  it('calculates tile count correctly', async () => {
    const image = await createTestImage(1024, 1024);
    const result = await preprocessTileMode(image);

    const { width, height } = result.metadata.resizedDimensions;
    const expectedTiles = Math.ceil(width / 512) * Math.ceil(height / 512);
    expect((result.metadata as any).tileCount).toBe(expectedTiles);
  });

  it('calculates estimated tokens using Anthropic formula', async () => {
    const image = await createTestImage(1000, 750);
    const result = await preprocessTileMode(image);

    const { width, height } = result.metadata.resizedDimensions;
    const expectedTokens = Math.round((width * height) / 750);
    expect(result.metadata.estimatedTokens).toBe(expectedTokens);
  });

  describe('token budget', () => {
    it('respects maxTokenBudget', async () => {
      const image = await createTestImage(3000, 2000);
      const result = await preprocessTileMode(image, { maxTokenBudget: 1000 });

      expect(result.metadata.estimatedTokens).toBeLessThanOrEqual(1000);
    });

    it('does not upscale when under budget', async () => {
      const image = await createTestImage(400, 300);
      const result = await preprocessTileMode(image, { maxTokenBudget: 10000 });

      expect(result.metadata.resizedDimensions.width).toBe(400);
      expect(result.metadata.resizedDimensions.height).toBe(300);
    });
  });

  describe('target token count for customer use case', () => {
    it('achieves <= 2000 tokens per image with budget', async () => {
      const image = await createTestImage(4000, 3000);
      const result = await preprocessTileMode(image, { maxTokenBudget: 2000 });

      expect(result.metadata.estimatedTokens).toBeLessThanOrEqual(2000);
    });
  });
});
