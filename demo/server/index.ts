// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
//
// Local development server. Keep the routes, limits, and error handling here in
// sync with lambda.ts, which serves the same API in the deployed stack.
//
import express from 'express';
import multer from 'multer';
import { preprocessPatchMode, preprocessTileMode } from '../../src/index.js';
import type { DetailLevel, ImageDimensions } from '../../src/types.js';
import { getImageDimensions } from '../../src/utils.js';
import { listVisionModels, invokeModel } from './bedrock-client.js';

// Upload limits. Files are buffered in memory, so a single request holds up to
// MAX_FILES * MAX_FILE_BYTES (96 MB here) at once, plus whatever sharp
// allocates to decode each one. Keep that total well under the Lambda
// memorySize in demo/deploy/lib/stack.ts.
const MAX_FILES = 8;
const MAX_FILE_BYTES = 12 * 1024 * 1024;

// A small compressed file can decode to an enormous bitmap ("pixel bomb"), so
// cap decoded size too. 25 MP is roughly 5000x5000 -- far more than this
// comparison demo needs, and well below sharp's own ~268 MP default.
const MAX_PIXELS = 25_000_000;

const app = express();
const port = parseInt(process.env.PORT || '3001');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

// No CORS middleware: the Vite dev server proxies /api to this port (see
// demo/client/vite.config.ts), so the browser only ever talks to its own
// origin. The deployed stack is same-origin behind CloudFront for the same
// reason. Wildcard CORS on an authenticated API is not a default worth copying.
app.use(express.json());

/** An error whose message is written here and therefore safe to return. */
class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Send a client-safe error, logging the detail server-side.
 *
 * Upstream error bodies can carry request IDs, model ARNs, and other internal
 * detail, so they go to the log -- CloudWatch in the deployed stack -- and never
 * to the browser.
 */
function sendError(res: express.Response, err: unknown, fallback: string): void {
  if (err instanceof RequestError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(fallback, err);
  res.status(500).json({ error: fallback });
}

/**
 * Read dimensions and reject anything above the pixel budget. sharp parses the
 * header without decoding, so this runs before any expensive work.
 */
async function checkedDimensions(file: Express.Multer.File): Promise<ImageDimensions> {
  const dims = await getImageDimensions(file.buffer);
  if (dims.width * dims.height > MAX_PIXELS) {
    throw new RequestError(
      413,
      `${file.originalname} decodes to ${dims.width}x${dims.height} pixels, above this demo's ${MAX_PIXELS}-pixel limit`
    );
  }
  return dims;
}

interface ImageInfo {
  filename: string;
  original: {
    width: number;
    height: number;
    sizeBytes: number;
    estimatedTokens: number;
  };
  processed?: {
    width: number;
    height: number;
    sizeBytes: number;
    estimatedTokens: number;
    base64Preview: string;
  };
}

function getTokenFormula(modelId: string): 'patch' | 'tile' {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('gpt-')) return 'patch';
  if (lower.includes('anthropic') || lower.includes('claude')) return 'tile';
  if (lower.includes('nova')) return 'tile';
  return 'patch';
}

function estimateRawTokens(width: number, height: number, formula: 'patch' | 'tile'): number {
  if (formula === 'patch') {
    const patches = Math.ceil(width / 32) * Math.ceil(height / 32);
    return Math.round(patches * 1.62);
  }
  return Math.round((width * height) / 750);
}

function parseMode(mode: string): { type: 'patch' | 'tile'; detail: DetailLevel } {
  if (mode === 'tile') return { type: 'tile', detail: 'high' };
  if (mode === 'patch-low') return { type: 'patch', detail: 'low' };
  if (mode === 'patch-original') return { type: 'patch', detail: 'original' };
  return { type: 'patch', detail: 'high' };
}

async function processFile(file: Express.Multer.File, mode: string, formula: 'patch' | 'tile') {
  const { type, detail } = parseMode(mode);

  await checkedDimensions(file);

  let result;
  if (type === 'patch') {
    result = await preprocessPatchMode(file.buffer, { detail });
  } else {
    result = await preprocessTileMode(file.buffer, {});
  }

  const metadata = result.metadata;
  const originalDimensions = metadata.originalDimensions;
  const resizedDimensions = metadata.resizedDimensions;
  const originalTokens = estimateRawTokens(originalDimensions.width, originalDimensions.height, formula);

  const info: ImageInfo = {
    filename: file.originalname,
    original: {
      width: originalDimensions.width,
      height: originalDimensions.height,
      sizeBytes: file.buffer.length,
      estimatedTokens: originalTokens,
    },
    processed: {
      width: resizedDimensions.width,
      height: resizedDimensions.height,
      sizeBytes: Buffer.from(result.base64, 'base64').length,
      estimatedTokens: metadata.estimatedTokens,
      base64Preview: `data:${result.mimeType};base64,${result.base64}`,
    },
  };

  return { info, base64: result.base64, mimeType: result.mimeType };
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/models', async (_req, res) => {
  try {
    const models = await listVisionModels();
    res.json({ models });
  } catch (err: unknown) {
    sendError(res, err, 'Failed to list models');
  }
});

app.post('/api/preprocess-only', upload.array('images', MAX_FILES), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No images uploaded' });
      return;
    }

    const mode = (req.body.mode as string) || 'patch-high';
    const modelId = (req.body.modelId as string) || '';
    const formula = modelId ? getTokenFormula(modelId) : (mode.startsWith('patch') ? 'patch' : 'tile');
    const startTime = Date.now();
    const images: ImageInfo[] = [];

    for (const file of files) {
      if (mode === 'none') {
        const dims = await checkedDimensions(file);
        const originalTokens = estimateRawTokens(dims.width, dims.height, formula);
        images.push({
          filename: file.originalname,
          original: { width: dims.width, height: dims.height, sizeBytes: file.buffer.length, estimatedTokens: originalTokens },
        });
        continue;
      }

      const { info } = await processFile(file, mode, formula);
      images.push(info);
    }

    res.json({ images, preprocessingMs: Date.now() - startTime });
  } catch (err: unknown) {
    sendError(res, err, 'Processing failed');
  }
});

app.post('/api/process', upload.array('images', MAX_FILES), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No images uploaded' });
      return;
    }

    const mode = (req.body.mode as string) || 'patch-high';
    const modelId = (req.body.modelId as string) || 'anthropic.claude-sonnet-4-20250514';
    const prompt = (req.body.prompt as string) || 'Describe what you see in these images.';
    const formula = getTokenFormula(modelId);

    const startTime = Date.now();
    const images: ImageInfo[] = [];
    const inferenceImages: { base64: string; mimeType: string }[] = [];

    for (const file of files) {
      const { info, base64, mimeType } = await processFile(file, mode, formula);
      images.push(info);
      inferenceImages.push({ base64, mimeType });
    }

    const preprocessingMs = Date.now() - startTime;
    const { result, error } = await invokeModel(modelId, inferenceImages, prompt);

    const estimatedBefore = images.reduce((sum, img) => sum + img.original.estimatedTokens, 0);
    const estimatedAfter = images.reduce((sum, img) => sum + (img.processed?.estimatedTokens ?? 0), 0);
    const actualTokens = result?.inputTokens ?? null;

    res.json({
      images,
      inference: result,
      error,
      totals: {
        estimatedTokensBefore: estimatedBefore,
        estimatedTokensAfter: estimatedAfter,
        actualTokens,
        estimateErrorPercent: actualTokens ? Math.round(((actualTokens - estimatedAfter) / estimatedAfter) * 1000) / 10 : null,
      },
      preprocessingMs,
    });
  } catch (err: unknown) {
    sendError(res, err, 'Processing failed');
  }
});

app.post('/api/process-raw', upload.array('images', MAX_FILES), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No images uploaded' });
      return;
    }

    const modelId = (req.body.modelId as string) || 'anthropic.claude-sonnet-4-20250514';
    const prompt = (req.body.prompt as string) || 'Describe what you see in these images.';
    const formula = getTokenFormula(modelId);

    const images: ImageInfo[] = [];
    const inferenceImages: { base64: string; mimeType: string }[] = [];

    for (const file of files) {
      const dims = await checkedDimensions(file);
      const originalTokens = estimateRawTokens(dims.width, dims.height, formula);

      images.push({
        filename: file.originalname,
        original: { width: dims.width, height: dims.height, sizeBytes: file.buffer.length, estimatedTokens: originalTokens },
      });
      inferenceImages.push({ base64: file.buffer.toString('base64'), mimeType: file.mimetype || 'image/jpeg' });
    }

    const { result, error } = await invokeModel(modelId, inferenceImages, prompt);
    const estimatedTotal = images.reduce((sum, img) => sum + img.original.estimatedTokens, 0);

    res.json({
      images,
      inference: result,
      error,
      totals: { estimatedTokensRaw: estimatedTotal, actualTokens: result?.inputTokens ?? null },
    });
  } catch (err: unknown) {
    sendError(res, err, 'Processing failed');
  }
});

// Multer enforces the upload limits in middleware, before any route handler
// runs, so its rejections need translating into JSON here or the client gets
// Express's default HTML error page.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `Each image must be ${MAX_FILE_BYTES} bytes or smaller` });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(413).json({ error: `Upload at most ${MAX_FILES} images per request` });
      return;
    }
    res.status(400).json({ error: 'Upload rejected' });
    return;
  }
  console.error('Unhandled request error', err);
  res.status(500).json({ error: 'Processing failed' });
});

app.listen(port, () => {
  console.log(`Demo server running at http://localhost:${port}`);
});
