// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, it, expect } from 'vitest';
import { parseImageInput, calculatePatchCount, calculateScaledDimensions } from '../src/utils.js';

describe('parseImageInput', () => {
  it('identifies Buffer input', () => {
    const result = parseImageInput(Buffer.from('test'));
    expect(result.type).toBe('buffer');
  });

  it('identifies URL input', () => {
    const result = parseImageInput('https://example.com/image.jpg');
    expect(result.type).toBe('url');
  });

  it('identifies base64 input', () => {
    const result = parseImageInput('iVBORw0KGgoAAAANS...');
    expect(result.type).toBe('base64');
  });

  it('identifies data URI input', () => {
    const result = parseImageInput('data:image/png;base64,iVBORw0...');
    expect(result.type).toBe('base64');
  });

  it('identifies s3:// URI input', () => {
    const result = parseImageInput('s3://my-bucket/path/to/image.jpg');
    expect(result.type).toBe('s3');
  });

  it('identifies S3Uri object input', () => {
    const result = parseImageInput({ bucket: 'my-bucket', key: 'image.jpg' });
    expect(result.type).toBe('s3');
  });
});

describe('calculatePatchCount', () => {
  it('calculates correct patch count', () => {
    expect(calculatePatchCount(512, 512)).toBe(256); // 16 * 16
    expect(calculatePatchCount(1024, 1024)).toBe(1024); // 32 * 32
    expect(calculatePatchCount(33, 33)).toBe(4); // ceil(33/32) * ceil(33/32) = 2 * 2
  });

  it('handles non-divisible dimensions', () => {
    expect(calculatePatchCount(100, 100)).toBe(16); // ceil(100/32) * ceil(100/32) = 4 * 4
  });
});

describe('calculateScaledDimensions', () => {
  it('scales down to fit within bounds', () => {
    const result = calculateScaledDimensions({ width: 4000, height: 3000 }, 2048, 2048);
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
  });

  it('preserves aspect ratio', () => {
    const result = calculateScaledDimensions({ width: 4000, height: 2000 }, 2048, 2048);
    const ratio = result.width / result.height;
    expect(ratio).toBeCloseTo(2.0, 1);
  });

  it('does not upscale', () => {
    const result = calculateScaledDimensions({ width: 800, height: 600 }, 2048, 2048);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });
});
