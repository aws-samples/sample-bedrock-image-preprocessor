// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
export function DocsPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <section>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Requirements &amp; Features</h2>
        <p className="text-gray-600">
          A TypeScript/Node.js library that implements client-side image preprocessing for AWS
          Bedrock inference requests, replicating the image optimization that OpenAI performs
          server-side. Usable as a standalone library or as middleware in an AI SDK pipeline.
        </p>
      </section>

      {/* Preprocessing Modes */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Preprocessing Modes</h3>

        <div className="border rounded-lg overflow-hidden">
          <div className="bg-indigo-50 px-4 py-3 border-b">
            <h4 className="font-semibold text-indigo-900">Mode 1: Patch-Based (OpenAI models on Bedrock Mantle)</h4>
          </div>
          <div className="p-4 space-y-2 text-sm text-gray-700">
            <p>Replicates OpenAI's patch-based tokenization system:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Accepts images as Buffer, URL, base64, data URI, or S3 URI</li>
              <li>Calculates patch count: <code className="bg-gray-100 px-1 rounded">ceil(width/32) × ceil(height/32)</code></li>
              <li>Applies patch budgets based on detail level:
                <ul className="list-disc list-inside ml-4 mt-1 space-y-0.5">
                  <li><strong>Low:</strong> Fixed 512×512 resize</li>
                  <li><strong>High:</strong> Max 2,500 patches OR 2048px max dimension</li>
                  <li><strong>Original:</strong> Max 10,000 patches OR 6000px max dimension</li>
                </ul>
              </li>
              <li>Resizes proportionally (preserving aspect ratio) to fit within BOTH constraints</li>
              <li>Outputs as JPEG (quality 85) for photos, PNG for diagrams/screenshots</li>
              <li>Returns metadata: original/resized dimensions, patch count, estimated tokens (patches × 1.62)</li>
            </ol>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <div className="bg-teal-50 px-4 py-3 border-b">
            <h4 className="font-semibold text-teal-900">Mode 2: Tile-Based (Anthropic models on Bedrock Runtime)</h4>
          </div>
          <div className="p-4 space-y-2 text-sm text-gray-700">
            <p>Adapted from OpenAI's tile system for Anthropic's token formula:</p>
            <ol className="list-decimal list-inside space-y-1 ml-2">
              <li>Scales image to fit within 2048×2048 (preserves aspect ratio)</li>
              <li>Constrains longest edge to 1568px, shortest to 768px</li>
              <li>Divides into 512×512 tiles</li>
              <li>Optionally resizes to target a maximum token budget</li>
              <li>Token formula: <code className="bg-gray-100 px-1 rounded">(width × height) / 750</code></li>
              <li>Returns metadata: original/resized dimensions, tile count, estimated tokens</li>
            </ol>
          </div>
        </div>
      </section>

      {/* Batch Processing */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Batch Processing</h3>
        <div className="bg-gray-50 border rounded-lg p-4">
          <pre className="text-sm text-gray-800 font-mono overflow-x-auto">
{`preprocessImages(images: ImageInput[], options: PreprocessOptions): Promise<ProcessedImage[]>`}
          </pre>
          <ul className="mt-3 text-sm text-gray-700 space-y-1 list-disc list-inside">
            <li>Accepts arrays of images (URLs, Buffers, base64 strings, or S3 URIs)</li>
            <li>For URLs: fetches the image first, then processes</li>
            <li>For S3 URIs: fetches via AWS SDK, then processes</li>
            <li>Applies the selected mode to each image</li>
            <li><code className="bg-gray-100 px-1 rounded">maxTotalTokens</code> option distributes a token budget across all images, reducing quality proportionally if the batch would exceed it</li>
          </ul>
        </div>
      </section>

      {/* AI SDK Integration */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">AI SDK Integration</h3>
        <p className="text-sm text-gray-700">
          Provides middleware that intercepts AI SDK messages containing image content,
          preprocesses them, and passes the optimized images to Bedrock:
        </p>
        <div className="bg-gray-50 border rounded-lg p-4">
          <pre className="text-sm text-gray-800 font-mono overflow-x-auto whitespace-pre">
{`import { createOpenAI } from '@ai-sdk/openai';
import { createImagePreprocessor } from 'bedrock-image-preprocessor';

const bedrock = createOpenAI({
  baseURL: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
  apiKey: 'bedrock',
});

const preprocessor = createImagePreprocessor({
  mode: 'patch',
  detail: 'high',
  maxTokensPerImage: 2000,
});

// Transform params before sending to model
const params = await preprocessor.transformParams({ messages });`}
          </pre>
        </div>

        <div className="bg-gray-50 border rounded-lg p-4 space-y-3">
          <h4 className="font-semibold text-gray-900 text-sm">How the AI SDK fits in</h4>
          <p className="text-sm text-gray-700">
            The AI SDK is <strong>not</strong> used in this demo application. The demo backend calls
            Bedrock directly via <code className="bg-gray-100 px-1 rounded">@aws-sdk/client-bedrock-runtime</code> (ConverseCommand)
            to keep things simple and dependency-free.
          </p>
          <p className="text-sm text-gray-700">
            The library exports <code className="bg-gray-100 px-1 rounded">createImagePreprocessor</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">wrapLanguageModel</code> which are designed to integrate
            with the AI SDK — they transform message objects that match the AI SDK's shape. The{' '}
            <code className="bg-gray-100 px-1 rounded">ai</code> package is listed as an optional peer dependency,
            not a hard requirement.
          </p>
          <p className="text-sm text-gray-700">
            In a production application, the customer would use the middleware like this:
          </p>
          <pre className="text-sm text-gray-800 font-mono bg-white border rounded p-3 overflow-x-auto whitespace-pre">
{`import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel } from 'bedrock-image-preprocessor';

const bedrock = createOpenAI({
  baseURL: 'https://bedrock-mantle.us-east-2.api.aws/openai/v1',
  apiKey: 'bedrock',
});

// Wrap the model — images are auto-preprocessed before each request
const model = wrapLanguageModel(bedrock('gpt-4o'), {
  mode: 'patch',
  detail: 'high',
  maxTokensPerImage: 2000,
});

// Use normally — preprocessing happens transparently
const result = await generateText({ model, messages });`}
          </pre>
          <p className="text-sm text-gray-500">
            The middleware intercepts <code className="bg-gray-100 px-1 rounded">doGenerate</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">doStream</code> calls via a Proxy, preprocesses
            any image content parts, and forwards the optimized payload to the underlying model.
            This demo proves the preprocessing logic works — the AI SDK integration is a thin
            wrapper on top.
          </p>
        </div>
      </section>

      {/* Supported Inputs */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Supported Input Types</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { type: 'Buffer', desc: 'Node.js Buffer object' },
            { type: 'URL', desc: 'HTTP/HTTPS URLs (auto-fetched)' },
            { type: 'Base64', desc: 'Raw base64 string' },
            { type: 'Data URI', desc: 'data:image/...;base64,...' },
            { type: 'S3 URI', desc: 's3://bucket/key' },
            { type: 'S3 Object', desc: '{ bucket, key, region }' },
          ].map((input) => (
            <div key={input.type} className="bg-white border rounded-lg p-3">
              <div className="font-medium text-sm text-gray-900">{input.type}</div>
              <div className="text-xs text-gray-500">{input.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Supported Formats */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Supported Image Formats</h3>
        <div className="flex gap-3 flex-wrap">
          {['JPEG', 'PNG', 'WebP', 'GIF (first frame)'].map((fmt) => (
            <span key={fmt} className="px-3 py-1 bg-gray-100 border rounded-full text-sm text-gray-700">
              {fmt}
            </span>
          ))}
        </div>
      </section>

      {/* Technical Constraints */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Technical Constraints</h3>
        <ul className="text-sm text-gray-700 space-y-2 list-disc list-inside">
          <li>Uses <code className="bg-gray-100 px-1 rounded">sharp</code> for image manipulation (fast, Lambda-compatible, no GUI dependencies)</li>
          <li>Handles EXIF rotation metadata (auto-orient before resizing)</li>
          <li>Memory efficient: streams large images rather than loading fully into memory</li>
          <li>Error handling for corrupt images, unsupported formats, and network failures</li>
          <li>No canvas/browser dependencies — synchronous-safe for Lambda</li>
        </ul>
      </section>

      {/* Token Budget */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Token Budget Reference</h3>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm text-amber-900 font-medium mb-2">Target scenario:</p>
          <ul className="text-sm text-amber-800 space-y-1 list-disc list-inside">
            <li>10-15 images per request</li>
            <li>Total context budget: ~128K tokens (shared with text prompts and tool calls)</li>
            <li>Target: each image ≤ 2,000 tokens after preprocessing</li>
            <li>Current state (without preprocessing): each image consumes 20,000-40,000 tokens</li>
          </ul>
        </div>
      </section>

      {/* Deployment */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">Deployment</h3>
        <p className="text-sm text-gray-700">
          The library runs anywhere Node.js ≥ 20.9.0 is available with native module support (for sharp).
        </p>

        <div className="space-y-3">
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-orange-50 px-4 py-2 border-b">
              <h4 className="font-semibold text-orange-900 text-sm">AWS Lambda</h4>
            </div>
            <div className="p-4 text-sm text-gray-700 space-y-2">
              <p>
                The primary deployment target. <code className="bg-gray-100 px-1 rounded">sharp</code> ships
                Lambda-compatible prebuilt binaries. Package as a Lambda layer or bundle with your function.
              </p>
              <pre className="bg-gray-50 border rounded p-3 font-mono text-xs overflow-x-auto">
{`# Install for Lambda (linux-x64)
npm install --platform=linux --arch=x64 sharp

# Bundle as a layer
mkdir -p layer/nodejs
cp -r node_modules layer/nodejs/
cd layer && zip -r ../layer.zip .`}
              </pre>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-orange-50 px-4 py-2 border-b">
              <h4 className="font-semibold text-orange-900 text-sm">EC2 / ECS / Fargate</h4>
            </div>
            <div className="p-4 text-sm text-gray-700">
              <p>No special configuration needed. Install dependencies and run as part of your existing service.</p>
              <pre className="bg-gray-50 border rounded p-3 font-mono text-xs mt-2 overflow-x-auto">
{`# This sample is not published to a package registry.
# Copy the src/ module into your project and import it directly.`}
              </pre>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-orange-50 px-4 py-2 border-b">
              <h4 className="font-semibold text-orange-900 text-sm">Docker</h4>
            </div>
            <div className="p-4 text-sm text-gray-700">
              <pre className="bg-gray-50 border rounded p-3 font-mono text-xs overflow-x-auto">
{`FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]`}
              </pre>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="bg-orange-50 px-4 py-2 border-b">
              <h4 className="font-semibold text-orange-900 text-sm">Running the Demo Locally</h4>
            </div>
            <div className="p-4 text-sm text-gray-700 space-y-2">
              <pre className="bg-gray-50 border rounded p-3 font-mono text-xs overflow-x-auto">
{`# Clone and install
git clone <repo-url>
cd bedrock-image-preprocessor

# Install library dependencies
npm install

# Start the backend (port 3001)
cd demo/server && npm install && npm run dev

# In another terminal, start the frontend (port 5173)
cd demo/client && npm install && npm run dev

# Open http://localhost:5173`}
              </pre>
              <p className="text-gray-500 text-xs mt-2">
                The demo works without AWS credentials for preprocessing comparison.
                Inference requires configured AWS credentials with Bedrock access.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mt-4">
          <h4 className="font-semibold text-red-900 text-sm mb-2">Not Supported</h4>
          <ul className="text-sm text-red-800 space-y-1 list-disc list-inside">
            <li>Browsers (sharp requires native binaries)</li>
            <li>CloudFront Functions / Lambda@Edge with &lt;50MB limit</li>
            <li>Cloudflare Workers (no native module support)</li>
          </ul>
        </div>
      </section>

      {/* API Reference */}
      <section className="space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">API Reference</h3>
        <div className="space-y-3">
          {[
            {
              name: 'preprocessPatchMode(input, options)',
              desc: 'Process a single image using OpenAI-style patch budgets.',
            },
            {
              name: 'preprocessTileMode(input, options)',
              desc: 'Process a single image using Anthropic-style tile constraints.',
            },
            {
              name: 'preprocessImages(images, options)',
              desc: 'Batch process multiple images with optional total token budget.',
            },
            {
              name: 'createImagePreprocessor(options)',
              desc: 'Create a middleware object with transformParams() for AI SDK integration.',
            },
            {
              name: 'wrapLanguageModel(model, options)',
              desc: 'Wrap an AI SDK language model to auto-preprocess images.',
            },
          ].map((api) => (
            <div key={api.name} className="flex items-start gap-3 bg-white border rounded-lg p-3">
              <code className="text-sm font-mono text-indigo-700 shrink-0">{api.name}</code>
              <span className="text-sm text-gray-600">{api.desc}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
