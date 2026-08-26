// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { isPrivateAddress, resolveImageBuffer } from '../src/utils.js';

describe('isPrivateAddress', () => {
  it('blocks the instance metadata endpoint', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  it('blocks RFC 1918 private space', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('172.16.0.1')).toBe(true);
    expect(isPrivateAddress('172.31.255.255')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
  });

  it('blocks loopback and unspecified', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
  });

  it('blocks IPv6 unique-local and link-local', () => {
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12:3456::1')).toBe(true);
    expect(isPrivateAddress('fe80::1')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 forms of blocked addresses', () => {
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('2606:2800:220:1::1')).toBe(false);
  });
});

// A one-pixel PNG, small enough to inline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

let server: Server;
let origin: string;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/image.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PNG.length) });
      res.end(PNG);
      return;
    }

    if (url === '/declared-huge') {
      // Declares a body far above the cap; must be rejected on the header alone.
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': '999999999' });
      res.end(PNG);
      return;
    }

    if (url === '/chunked-huge') {
      // No content-length, so only a streamed byte count can catch this.
      res.writeHead(200, { 'content-type': 'image/png' });
      const chunk = Buffer.alloc(64 * 1024, 1);
      const pump = () => {
        if (!res.write(chunk)) {
          res.once('drain', pump);
          return;
        }
        setImmediate(pump);
      };
      pump();
      return;
    }

    if (url === '/hang') {
      // Headers, then silence, to exercise the total-time budget.
      res.writeHead(200, { 'content-type': 'image/png' });
      return;
    }

    if (url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' });
      res.end();
      return;
    }

    if (url === '/redirect-to-image') {
      res.writeHead(302, { location: '/image.png' });
      res.end();
      return;
    }

    if (url === '/redirect-other-host') {
      res.writeHead(302, { location: `http://localhost:${port}/image.png` });
      res.end();
      return;
    }

    if (url === '/redirect-to-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('resolveImageBuffer — url inputs', () => {
  it('fetches an image when no restrictions are set', async () => {
    const buffer = await resolveImageBuffer(`${origin}/image.png`);
    expect(buffer.equals(PNG)).toBe(true);
  });

  it('follows a redirect within the cap', async () => {
    const buffer = await resolveImageBuffer(`${origin}/redirect-to-image`);
    expect(buffer.equals(PNG)).toBe(true);
  });

  it('rejects a private address when blockPrivateNetworks is on', async () => {
    await expect(
      resolveImageBuffer(`${origin}/image.png`, { blockPrivateNetworks: true })
    ).rejects.toThrow(/private or link-local/);
  });

  it('rejects a bracketed IPv6 loopback literal', async () => {
    await expect(
      resolveImageBuffer('http://[::1]/image.png', { blockPrivateNetworks: true })
    ).rejects.toThrow(/private or link-local address: ::1/);
  });

  it('rejects a host outside allowedHosts', async () => {
    await expect(
      resolveImageBuffer(`${origin}/image.png`, { allowedHosts: ['images.example.com'] })
    ).rejects.toThrow(/not in allowedHosts/);
  });

  it('allows a host inside allowedHosts', async () => {
    const buffer = await resolveImageBuffer(`${origin}/image.png`, {
      allowedHosts: ['127.0.0.1'],
    });
    expect(buffer.equals(PNG)).toBe(true);
  });

  it('re-validates the allowlist on each redirect hop', async () => {
    // The first hop is allowed; the redirect target is a different hostname
    // and must be rejected rather than silently followed.
    await expect(
      resolveImageBuffer(`${origin}/redirect-other-host`, { allowedHosts: ['127.0.0.1'] })
    ).rejects.toThrow(/not in allowedHosts: localhost/);
  });

  it('rejects a redirect to a non-http protocol', async () => {
    await expect(resolveImageBuffer(`${origin}/redirect-to-file`)).rejects.toThrow(
      /unsupported protocol: file:/
    );
  });

  it('enforces the redirect cap', async () => {
    await expect(
      resolveImageBuffer(`${origin}/redirect-loop`, { maxRedirects: 2 })
    ).rejects.toThrow(/redirect limit of 2/);
  });

  it('rejects an oversized body declared by content-length', async () => {
    await expect(
      resolveImageBuffer(`${origin}/declared-huge`, { maxBytes: 1024 })
    ).rejects.toThrow(/above the 1024-byte limit/);
  });

  it('rejects an oversized body with no content-length', async () => {
    await expect(
      resolveImageBuffer(`${origin}/chunked-huge`, { maxBytes: 128 * 1024 })
    ).rejects.toThrow(/exceeds the 131072-byte limit/);
  });

  it('times out a stalled response', async () => {
    await expect(
      resolveImageBuffer(`${origin}/hang`, { timeoutMs: 150 })
    ).rejects.toThrow(/Timed out after 150ms/);
  });

  it('still reports a failed status', async () => {
    await expect(resolveImageBuffer(`${origin}/missing`)).rejects.toThrow(
      /Failed to fetch image from URL: 404/
    );
  });
});

describe('resolveImageBuffer — s3 inputs', () => {
  it('rejects a bucket outside allowedBuckets before any API call', async () => {
    await expect(
      resolveImageBuffer('s3://attacker-chosen-bucket/key.png', {
        allowedBuckets: ['my-approved-bucket'],
      })
    ).rejects.toThrow(/not in allowedBuckets: attacker-chosen-bucket/);
  });
});
