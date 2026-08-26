// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, it, expect } from 'vitest';
import { preprocessPatchMode } from '../src/patch-mode.js';
import { createTestImage, createScreenshotImage } from './helpers.js';

describe('preprocessPatchMode', () => {
  describe('low detail', () => {
    it('resizes any image to 512x512', async () => {
      const image = await createTestImage(4000, 3000);
      const result = await preprocessPatchMode(image, { detail: 'low' });

      expect(result.metadata.resizedDimensions.width).toBe(512);
      expect(result.metadata.resizedDimensions.height).toBe(512);
      expect(result.metadata.patchCount).toBe(256); // 16 * 16
    });

    it('produces low token count', async () => {
      const image = await createTestImage(4000, 3000);
      const result = await preprocessPatchMode(image, { detail: 'low' });

      expect(result.metadata.estimatedTokens).toBeLessThan(500);
    });
  });

  describe('high detail', () => {
    it('constrains to 2048px max dimension', async () => {
      const image = await createTestImage(4000, 3000);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      const { width, height } = result.metadata.resizedDimensions;
      expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
    });

    it('constrains to 2500 patches', async () => {
      const image = await createTestImage(4000, 3000);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.metadata.patchCount).toBeLessThanOrEqual(2500);
    });

    it('keeps small images unchanged', async () => {
      const image = await createTestImage(800, 600);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.metadata.resizedDimensions.width).toBe(800);
      expect(result.metadata.resizedDimensions.height).toBe(600);
    });

    it('produces reasonable token count for typical images', async () => {
      const image = await createTestImage(2000, 1500);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.metadata.estimatedTokens).toBeLessThan(5000);
    });
  });

  describe('original detail', () => {
    it('allows up to 6000px dimension', async () => {
      const image = await createTestImage(5000, 4000);
      const result = await preprocessPatchMode(image, { detail: 'original' });

      const { width, height } = result.metadata.resizedDimensions;
      expect(Math.max(width, height)).toBeLessThanOrEqual(6000);
    });

    it('constrains to 10000 patches', async () => {
      const image = await createTestImage(5000, 4000);
      const result = await preprocessPatchMode(image, { detail: 'original' });

      expect(result.metadata.patchCount).toBeLessThanOrEqual(10000);
    });
  });

  describe('output format', () => {
    it('outputs jpeg for photographic images in auto mode', async () => {
      const image = await createTestImage(1000, 800, 'jpeg');
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.mimeType).toBe('image/jpeg');
    });

    it('outputs png for screenshot-like images in auto mode', async () => {
      const image = await createScreenshotImage(1024, 768);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.mimeType).toBe('image/png');
    });

    it('respects forced output format', async () => {
      const image = await createTestImage(1000, 800, 'jpeg');
      const result = await preprocessPatchMode(image, { detail: 'high', outputFormat: 'png' });

      expect(result.mimeType).toBe('image/png');
    });
  });

  describe('base64 input', () => {
    it('accepts base64 string input', async () => {
      const image = await createTestImage(1000, 800);
      const base64 = image.toString('base64');
      const result = await preprocessPatchMode(base64, { detail: 'high' });

      expect(result.base64).toBeTruthy();
      expect(result.metadata.originalDimensions.width).toBe(1000);
    });

    it('accepts data URI input', async () => {
      const image = await createTestImage(1000, 800);
      const dataUri = `data:image/jpeg;base64,${image.toString('base64')}`;
      const result = await preprocessPatchMode(dataUri, { detail: 'high' });

      expect(result.base64).toBeTruthy();
      expect(result.metadata.originalDimensions.width).toBe(1000);
    });
  });

  describe('metadata', () => {
    it('returns complete metadata', async () => {
      const image = await createTestImage(3000, 2000);
      const result = await preprocessPatchMode(image, { detail: 'high' });

      expect(result.metadata.originalDimensions).toEqual({ width: 3000, height: 2000 });
      expect(result.metadata.resizedDimensions.width).toBeGreaterThan(0);
      expect(result.metadata.resizedDimensions.height).toBeGreaterThan(0);
      expect(result.metadata.patchCount).toBeGreaterThan(0);
      expect(result.metadata.estimatedTokens).toBeGreaterThan(0);
    });
  });
});
