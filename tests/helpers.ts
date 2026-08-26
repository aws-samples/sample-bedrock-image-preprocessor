// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import sharp from 'sharp';

export async function createTestImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' = 'jpeg'
): Promise<Buffer> {
  const channels = format === 'png' ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels, 128);

  let pipeline = sharp(raw, { raw: { width, height, channels } });

  if (format === 'jpeg') {
    return pipeline.jpeg({ quality: 80 }).toBuffer();
  }
  return pipeline.png().toBuffer();
}

export async function createScreenshotImage(
  width: number,
  height: number
): Promise<Buffer> {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <rect x="10" y="10" width="200" height="30" fill="#333"/>
    <text x="20" y="30" font-size="14" fill="white">Menu Bar</text>
    <rect x="10" y="50" width="${width - 20}" height="${height - 60}" fill="#f0f0f0" stroke="#ccc"/>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
