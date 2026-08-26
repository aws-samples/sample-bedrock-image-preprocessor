// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
export function HomePage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          The Image Preprocessing Gap in AWS Bedrock
        </h2>
        <p className="text-gray-700 leading-relaxed">
          When customers send images to foundation models through AWS Bedrock, those images consume
          far more tokens than necessary — often 10-20x more than the same image sent through
          OpenAI or Anthropic's native APIs. This is because Bedrock does not preprocess images
          before passing them to models, while other providers do.
        </p>
      </section>

      <section className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-red-900 mb-3">
          Bedrock — No Preprocessing
        </h3>
        <p className="text-red-800 leading-relaxed mb-4">
          AWS Bedrock does not perform any server-side image preprocessing before passing images to
          models. When a user sends an image via the Converse API or the Mantle endpoint, the raw
          base64-encoded bytes are forwarded directly to the underlying model without resizing,
          tiling, or compression.
        </p>
        <p className="text-red-800 leading-relaxed">
          This results in massive token consumption for multi-image workflows, with context windows
          overflowing at just five to six images. A single 4000x3000 photograph consumes ~30,000
          tokens, meaning 10-15 images per request is impossible within a 128K context window.
        </p>
        <div className="mt-4 bg-red-100 rounded p-3 font-mono text-sm text-red-900">
          <div>10 images × 30,000 tokens = 300,000 tokens</div>
          <div>Context window: 128,000 tokens</div>
          <div className="font-bold mt-1">Result: context_length_exceeded</div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-6">
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-3">
            OpenAI — Automatic Preprocessing
          </h3>
          <p className="text-green-800 leading-relaxed text-sm mb-3">
            OpenAI implements automatic server-side preprocessing using two systems, both transparent
            to the developer:
          </p>
          <ul className="text-sm text-green-800 space-y-2">
            <li>
              <span className="font-medium">Patch-based (newer models):</span> Images are divided
              into 32x32 pixel patches with configurable budgets (up to 10,000 patches for full
              resolution). If an image exceeds the budget, OpenAI automatically scales it down
              proportionally while preserving aspect ratio.
            </li>
            <li>
              <span className="font-medium">Tile-based (older models):</span> Images are first
              resized to fit within 2048x2048, then the shortest side is scaled to 768px, and the
              image is divided into 512x512 tiles at a fixed token cost per tile.
            </li>
          </ul>
          <p className="text-xs text-green-600 mt-3">
            Supports a <code className="bg-green-100 px-1 rounded">detail</code> parameter for
            controlling the quality-cost tradeoff. Up to 1,500 images and 512 MB per request.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">
            Anthropic & Google — Platform Resizing
          </h3>
          <p className="text-blue-800 leading-relaxed text-sm mb-3">
            Other providers also resize images at the platform layer before model consumption:
          </p>
          <ul className="text-sm text-blue-800 space-y-2">
            <li>
              <span className="font-medium">Anthropic (native API):</span> Resizes images so the
              longest edge is 1,568px. Token cost = (width × height) / 750. However, this resizing
              does <em>not</em> appear to be applied when Claude models are invoked through
              Bedrock's Converse API.
            </li>
            <li>
              <span className="font-medium">Google Gemini:</span> Tiles images into 768x768 segments
              at 258 tokens each, with a configurable <code className="bg-blue-100 px-1 rounded">media_resolution</code> parameter.
            </li>
          </ul>
        </div>
      </section>

      <section className="bg-gray-50 border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          Bedrock Image Input Limits
        </h3>
        <p className="text-sm text-gray-600">
          Per-image size limits, maximum dimensions, and the number of images allowed per
          request vary by model, so check the documentation for the model you are using
          rather than assuming a fixed ceiling:
        </p>
        <ul className="text-sm text-gray-600 mt-3 space-y-1 list-disc list-inside">
          <li>
            <a
              className="text-blue-700 underline"
              href="https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html"
              target="_blank"
              rel="noreferrer"
            >
              Models at a glance
            </a>{' '}
            — per-model cards, including supported modalities and each model's quotas and limits
          </li>
          <li>
            <a
              className="text-blue-700 underline"
              href="https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html"
              target="_blank"
              rel="noreferrer"
            >
              Quotas for Amazon Bedrock
            </a>{' '}
            — account-level service quotas
          </li>
          <li>
            <a
              className="text-blue-700 underline"
              href="https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html"
              target="_blank"
              rel="noreferrer"
            >
              Inference using the Converse API
            </a>{' '}
            — the <code className="bg-gray-100 px-1 rounded">ImageBlock</code> request shape
          </li>
        </ul>
        <p className="text-sm text-gray-600 mt-4">
          One structural limit does apply across models: an{' '}
          <code className="bg-gray-100 px-1 rounded">ImageBlock</code> accepts raw image bytes
          or an Amazon S3 location, so there is no HTTP URL pass-through. Compare to OpenAI:
          1,500 images, 512 MB per request, and native URL support.
        </p>
      </section>

      <section className="bg-amber-50 border border-amber-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-amber-900 mb-3">
          The Gap
        </h3>
        <p className="text-amber-800 leading-relaxed mb-3">
          The absence of server-side preprocessing requires customers to implement their own
          pipeline (resizing, tiling, compression) before sending images to Bedrock. This library
          fills that gap with client-side preprocessing that replicates what other providers do
          automatically.
        </p>
        <p className="text-amber-800 leading-relaxed text-sm">
          Evidence from OpenAI's documentation indicates their preprocessing is implemented at the
          API/platform layer, not within the models themselves — suggesting Bedrock could implement
          equivalent functionality as a platform feature.
        </p>
      </section>

      <section className="bg-white border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">
          What This Demo Shows
        </h3>
        <p className="text-gray-700 leading-relaxed mb-3">
          The <span className="font-medium">Demo</span> tab lets you upload images and see the
          difference firsthand:
        </p>
        <ul className="text-gray-700 space-y-1 text-sm list-disc list-inside">
          <li>Upload multiple images (like a real multi-image workflow)</li>
          <li>Compare token consumption: raw vs. preprocessed</li>
          <li>See context window overflow when sending without preprocessing</li>
          <li>Verify the model still produces accurate responses with optimized images</li>
          <li>Compare estimated token counts (from formulas) vs. actual (from API response)</li>
        </ul>
      </section>
    </div>
  );
}
