// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, it, expect } from 'vitest';
import { preprocessImages } from '../src/batch.js';
import { createTestImage } from './helpers.js';

describe('preprocessImages (batch)', () => {
  it('processes multiple images in patch mode', async () => {
    const images = await Promise.all(
      Array.from({ length: 5 }, () => createTestImage(2000, 1500))
    );

    const results = await preprocessImages(images, { mode: 'patch', detail: 'high' });

    expect(results).toHaveLength(5);
    results.forEach((r) => {
      expect(r.base64).toBeTruthy();
      expect(r.metadata.patchCount).toBeLessThanOrEqual(2500);
    });
  });

  it('processes multiple images in tile mode', async () => {
    const images = await Promise.all(
      Array.from({ length: 5 }, () => createTestImage(3000, 2000))
    );

    const results = await preprocessImages(images, { mode: 'tile' });

    expect(results).toHaveLength(5);
    results.forEach((r) => {
      const { width, height } = r.metadata.resizedDimensions;
      expect(Math.max(width, height)).toBeLessThanOrEqual(1568);
    });
  });

  it('respects maxTotalTokens budget across batch', async () => {
    const images = await Promise.all(
      Array.from({ length: 10 }, () => createTestImage(3000, 2000))
    );

    const maxTotalTokens = 20000;
    const results = await preprocessImages(images, {
      mode: 'tile',
      maxTotalTokens,
    });

    const totalTokens = results.reduce((sum, r) => sum + r.metadata.estimatedTokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(maxTotalTokens * 1.1); // 10% tolerance
  });

  it('handles 15 images within 128K token budget', async () => {
    const images = await Promise.all(
      Array.from({ length: 15 }, () => createTestImage(4000, 3000))
    );

    const results = await preprocessImages(images, {
      mode: 'tile',
      maxTotalTokens: 30000, // ~2000 tokens per image
    });

    expect(results).toHaveLength(15);
    const totalTokens = results.reduce((sum, r) => sum + r.metadata.estimatedTokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(33000);
    results.forEach((r) => {
      expect(r.metadata.estimatedTokens).toBeLessThanOrEqual(3000);
    });
  });

  it('returns empty array for empty input', async () => {
    const results = await preprocessImages([], { mode: 'patch', detail: 'high' });
    expect(results).toEqual([]);
  });

  it('downgrades patch detail when budget is tight', async () => {
    const images = await Promise.all(
      Array.from({ length: 10 }, () => createTestImage(3000, 2000))
    );

    const results = await preprocessImages(images, {
      mode: 'patch',
      detail: 'high',
      maxTotalTokens: 5000, // Very tight budget
    });

    expect(results).toHaveLength(10);
    results.forEach((r) => {
      expect(r.metadata.estimatedTokens).toBeLessThan(1000);
    });
  });
});
