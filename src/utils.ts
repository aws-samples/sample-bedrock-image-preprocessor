// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import sharp from 'sharp';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ImageInput, S3Uri, ImageDimensions, RemoteFetchOptions } from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

/** Address blocks that must never be reachable when `blockPrivateNetworks` is on. */
const BLOCKED_IPV4_BLOCKS: { cidr: string; label: string }[] = [
  { cidr: '0.0.0.0/8', label: 'this-network' },
  { cidr: '10.0.0.0/8', label: 'private' },
  { cidr: '100.64.0.0/10', label: 'carrier-grade NAT' },
  { cidr: '127.0.0.0/8', label: 'loopback' },
  { cidr: '169.254.0.0/16', label: 'link-local (instance metadata)' },
  { cidr: '172.16.0.0/12', label: 'private' },
  { cidr: '192.0.0.0/24', label: 'IETF protocol assignments' },
  { cidr: '192.168.0.0/16', label: 'private' },
  { cidr: '198.18.0.0/15', label: 'benchmarking' },
  { cidr: '224.0.0.0/4', label: 'multicast' },
  { cidr: '240.0.0.0/4', label: 'reserved' },
];

function ipv4ToInt(address: string): number {
  const octets = address.split('.').map(Number);
  return ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
}

function matchIpv4Block(address: string, cidr: string): boolean {
  const [network, bitsRaw] = cidr.split('/');
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(network) & mask);
}

/** First 16-bit group of an IPv6 address, handling the `::` shorthand. */
function firstHextet(address: string): number {
  if (address.startsWith('::')) return 0;
  return parseInt(address.split(':')[0] || '0', 16) || 0;
}

/**
 * True for addresses that are not routable on the public internet: loopback,
 * link-local (which covers the 169.254.169.254 metadata endpoint), RFC 1918
 * private space, unique-local IPv6, and assorted reserved blocks.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    return BLOCKED_IPV4_BLOCKS.some((block) => matchIpv4Block(address, block.cidr));
  }
  if (version !== 6) return false;

  const normalized = address.toLowerCase();

  // IPv4-mapped (::ffff:169.254.169.254) and IPv4-compatible forms reach the
  // IPv4 stack, so they must be judged as IPv4.
  const mapped = normalized.match(/^::(?:ffff:)?((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  if (normalized === '::' || normalized === '::1') return true;

  const head = firstHextet(normalized);
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * Validate one hop of a remote fetch. Throws rather than returning a boolean so
 * that a rejected URL can never fall through to a fetch by mistake.
 */
async function assertUrlAllowed(url: URL, options: RemoteFetchOptions): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Refusing to fetch image over unsupported protocol: ${url.protocol}`);
  }

  // URL.hostname keeps the brackets around an IPv6 literal; strip them so that
  // both the allowlist and the address check see a bare host.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (options.allowedHosts) {
    const allowed = options.allowedHosts.some(
      (host) => host.replace(/^\[|\]$/g, '').toLowerCase() === hostname.toLowerCase()
    );
    if (!allowed) {
      throw new Error(`Host is not in allowedHosts: ${hostname}`);
    }
  }

  if (!options.blockPrivateNetworks) return;

  // A literal IP needs no resolution; a hostname is resolved and every answer
  // is checked, so a domain pointing at 169.254.169.254 is rejected too.
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

  const blocked = addresses.find((address) => isPrivateAddress(address));
  if (blocked) {
    throw new Error(
      `Refusing to fetch image from a private or link-local address: ${hostname} -> ${blocked}`
    );
  }
}

/** Read a response body, aborting as soon as it exceeds `maxBytes`. */
async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Remote image is ${declared} bytes, above the ${maxBytes}-byte limit`);
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Remote image exceeds the ${maxBytes}-byte limit`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Fetch a remote image under a total time budget, a byte cap, and a redirect
 * cap. Redirects are followed manually so that every hop is re-validated —
 * `redirect: 'follow'` would let an allowed host bounce the request to a
 * blocked address.
 */
async function fetchRemoteImage(rawUrl: string, options: RemoteFetchOptions): Promise<Buffer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let url = new URL(rawUrl);

    for (let hop = 0; hop <= maxRedirects; hop++) {
      await assertUrlAllowed(url, options);

      const response = await fetch(url, { redirect: 'manual', signal: controller.signal });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect from ${url.href} had no Location header`);
        }
        url = new URL(location, url);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch image from URL: ${response.status} ${response.statusText}`);
      }

      return await readCappedBody(response, maxBytes);
    }

    throw new Error(`Exceeded the redirect limit of ${maxRedirects} while fetching image`);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out after ${timeoutMs}ms fetching image`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function parseImageInput(input: ImageInput): { type: 'buffer' | 'url' | 'base64' | 's3'; value: ImageInput } {
  if (Buffer.isBuffer(input)) {
    return { type: 'buffer', value: input };
  }
  if (typeof input === 'object' && 'bucket' in input && 'key' in input) {
    return { type: 's3', value: input };
  }
  if (typeof input === 'string') {
    if (input.startsWith('s3://')) {
      const url = new URL(input);
      const s3Uri: S3Uri = { bucket: url.hostname, key: url.pathname.slice(1) };
      return { type: 's3', value: s3Uri };
    }
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return { type: 'url', value: input };
    }
    return { type: 'base64', value: input };
  }
  throw new Error('Unsupported image input type');
}

/**
 * Resolve any supported image input to a Buffer.
 *
 * ## Security
 *
 * `url` and `s3` inputs make this function issue an outbound request on behalf
 * of the caller. **Never pass an untrusted value without also passing
 * restrictions in `options`.** Doing so exposes two classic weaknesses:
 *
 * - **SSRF.** A URL is fetched from wherever the process runs, so an attacker
 *   who controls it can reach the cloud instance metadata endpoint
 *   (`169.254.169.254`) or any internal-only service. Pass
 *   `{ blockPrivateNetworks: true }`, or better, an explicit `allowedHosts`
 *   list.
 * - **Confused deputy.** An `s3://` URI is read with *this process's* IAM
 *   credentials, so an attacker who controls the bucket or key can read any
 *   object that role can reach. Pass `allowedBuckets`.
 *
 * A timeout, a response-size cap, and a redirect cap always apply; see
 * {@link RemoteFetchOptions} for the defaults.
 *
 * Note that `blockPrivateNetworks` resolves the hostname and checks the
 * answers, but does not pin the resolved address for the connection itself. A
 * determined attacker controlling a DNS server can still win that race (DNS
 * rebinding). An `allowedHosts` allowlist, or an egress policy enforced outside
 * the process, is the stronger control.
 */
export async function resolveImageBuffer(
  input: ImageInput,
  options: RemoteFetchOptions = {}
): Promise<Buffer> {
  const parsed = parseImageInput(input);

  switch (parsed.type) {
    case 'buffer':
      return parsed.value as Buffer;

    case 'base64': {
      const str = parsed.value as string;
      const base64Data = str.includes(',') ? str.split(',')[1] : str;
      return Buffer.from(base64Data, 'base64');
    }

    case 'url':
      return fetchRemoteImage(parsed.value as string, options);

    case 's3': {
      const s3Uri = parsed.value as S3Uri;

      if (options.allowedBuckets) {
        const allowed = options.allowedBuckets.includes(s3Uri.bucket);
        if (!allowed) {
          throw new Error(`Bucket is not in allowedBuckets: ${s3Uri.bucket}`);
        }
      }

      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const client = new S3Client({ region: s3Uri.region ?? 'us-east-1' });
      const command = new GetObjectCommand({ Bucket: s3Uri.bucket, Key: s3Uri.key });
      const response = await client.send(command);
      if (!response.Body) {
        throw new Error(`Empty response from S3: s3://${s3Uri.bucket}/${s3Uri.key}`);
      }
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    }

    default:
      throw new Error('Unsupported image input type');
  }
}

export async function getImageDimensions(buffer: Buffer): Promise<ImageDimensions> {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions');
  }
  return { width: metadata.width, height: metadata.height };
}

export function calculatePatchCount(width: number, height: number): number {
  return Math.ceil(width / 32) * Math.ceil(height / 32);
}

export function calculateScaledDimensions(
  original: ImageDimensions,
  maxWidth: number,
  maxHeight: number
): ImageDimensions {
  const { width, height } = original;
  const scaleX = maxWidth / width;
  const scaleY = maxHeight / height;
  const scale = Math.min(scaleX, scaleY, 1);

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

export async function isPhotographic(buffer: Buffer): Promise<boolean> {
  const metadata = await sharp(buffer).metadata();
  if (metadata.format === 'jpeg') return true;
  if (metadata.format === 'png') {
    if (metadata.channels === 4) return false;
    const stats = await sharp(buffer).stats();
    const avgEntropy = stats.channels.reduce((sum, ch) => sum + (ch.stdev / 255), 0) / stats.channels.length;
    return avgEntropy > 0.15;
  }
  return metadata.format === 'webp';
}
