// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
export interface VisionModel {
  modelId: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  inputModalities: string[];
}

export interface ImageOriginalInfo {
  width: number;
  height: number;
  sizeBytes: number;
  estimatedTokens: number;
}

export interface ImageProcessedInfo {
  width: number;
  height: number;
  sizeBytes: number;
  estimatedTokens: number;
  base64Preview: string;
}

export interface ImageResult {
  filename: string;
  original: ImageOriginalInfo;
  processed?: ImageProcessedInfo;
}

export interface InferenceResult {
  response: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface InferenceError {
  code: string;
  message: string;
}

export interface ProcessResponse {
  images: ImageResult[];
  inference: InferenceResult | null;
  error: InferenceError | null;
  totals: {
    estimatedTokensBefore: number;
    estimatedTokensAfter: number;
    actualTokens: number | null;
    estimateErrorPercent: number | null;
  };
  preprocessingMs: number;
}

export interface RawProcessResponse {
  images: ImageResult[];
  inference: InferenceResult | null;
  error: InferenceError | null;
  totals: {
    estimatedTokensRaw: number;
    actualTokens: number | null;
  };
}

export type PreprocessMode = 'patch-low' | 'patch-high' | 'patch-original' | 'tile';
