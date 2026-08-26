// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
export type DetailLevel = 'low' | 'high' | 'original';

export type ImageInputType = 'buffer' | 'url' | 'base64' | 's3';

export interface S3Uri {
  bucket: string;
  key: string;
  region?: string;
}

export type ImageInput = Buffer | string | S3Uri;

/**
 * Controls how the library fetches remote images (`http(s)://` URLs and
 * `s3://` URIs).
 *
 * The timeout, size cap, and redirect cap are always applied. The two
 * restriction controls — `blockPrivateNetworks` and `allowedHosts` /
 * `allowedBuckets` — are opt-in, because a legitimate caller may well be
 * fetching from a private image service. **Enable them whenever the input
 * can be influenced by an untrusted party.** See `resolveImageBuffer`.
 */
export interface RemoteFetchOptions {
  /** Total budget for a remote fetch, including redirects and body read. Default 10000. */
  timeoutMs?: number;

  /** Maximum bytes read from a remote source before the fetch is aborted. Default 26214400 (25 MiB). */
  maxBytes?: number;

  /** Maximum HTTP redirects to follow. Each hop is re-validated. Default 3. */
  maxRedirects?: number;

  /**
   * Reject URLs that resolve to loopback, link-local, or private address
   * space — including the cloud instance metadata endpoint at
   * 169.254.169.254. Default `false`; recommended `true` in production.
   */
  blockPrivateNetworks?: boolean;

  /**
   * When set, only these hostnames may be fetched (exact, case-insensitive
   * match). Applied to every redirect hop as well as the initial URL.
   */
  allowedHosts?: string[];

  /**
   * When set, only these S3 buckets may be read. Without it, an `s3://` input
   * can read any object the caller's IAM role can reach.
   */
  allowedBuckets?: string[];
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface PatchMetadata {
  originalDimensions: ImageDimensions;
  resizedDimensions: ImageDimensions;
  patchCount: number;
  estimatedTokens: number;
}

export interface TileMetadata {
  originalDimensions: ImageDimensions;
  resizedDimensions: ImageDimensions;
  tileCount: number;
  estimatedTokens: number;
}

export interface ProcessedImage {
  base64: string;
  mimeType: 'image/jpeg' | 'image/png';
  metadata: PatchMetadata | TileMetadata;
}

export type PreprocessMode = 'patch' | 'tile';

export interface PreprocessOptions {
  mode: PreprocessMode;
  detail?: DetailLevel;
  maxTotalTokens?: number;
  outputFormat?: 'jpeg' | 'png' | 'auto';
  jpegQuality?: number;
  /** Applied only when an input is a URL or `s3://` URI. */
  fetch?: RemoteFetchOptions;
}

export interface PatchModeOptions {
  detail: DetailLevel;
  outputFormat?: 'jpeg' | 'png' | 'auto';
  jpegQuality?: number;
  /** Applied only when the input is a URL or `s3://` URI. */
  fetch?: RemoteFetchOptions;
}

export interface TileModeOptions {
  maxTokenBudget?: number;
  outputFormat?: 'jpeg' | 'png' | 'auto';
  jpegQuality?: number;
  /** Applied only when the input is a URL or `s3://` URI. */
  fetch?: RemoteFetchOptions;
}
