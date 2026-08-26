# Sample Bedrock Image Preprocessor

Client-side image preprocessing for Amazon Bedrock inference requests. Replicates the image optimization that OpenAI and Anthropic perform server-side, reducing token consumption by 10-20x.

> **This is sample code**, provided for educational and demonstration purposes. It is **not** a supported product or a published package, and it is **not** intended for production use as-is. Review, test, and secure it for your own environment before adapting it. See [Security](#security) below.

## The Problem: The Image Preprocessing Gap in AWS Bedrock

When customers send images to foundation models through AWS Bedrock, those images consume far more tokens than necessary — often 10-20x more than the same image sent through OpenAI or Anthropic's native APIs. This is because Bedrock does not preprocess images before passing them to models, while other providers do.

### Bedrock — No Preprocessing

AWS Bedrock does not perform any server-side image preprocessing before passing images to models. When a user sends an image via the Converse API or the Mantle endpoint, the raw base64-encoded bytes are forwarded directly to the underlying model without resizing, tiling, or compression.

This results in massive token consumption for multi-image workflows, with context windows overflowing at just five to six images. A single 4000x3000 photograph consumes ~30,000 tokens, meaning 10-15 images per request is impossible within a 128K context window.

```
10 images × 30,000 tokens = 300,000 tokens
Context window: 128,000 tokens
Result: context_length_exceeded
```

### Other Providers — Automatic Preprocessing

**OpenAI** implements automatic server-side preprocessing using two systems, both transparent to the developer:

- **Patch-based (newer models):** Images are divided into 32x32 pixel patches with configurable budgets (up to 10,000 patches for full resolution). If an image exceeds the budget, OpenAI automatically scales it down proportionally while preserving aspect ratio.
- **Tile-based (older models):** Images are first resized to fit within 2048x2048, then the shortest side is scaled to 768px, and the image is divided into 512x512 tiles at a fixed token cost per tile.

Supports a `detail` parameter for controlling the quality-cost tradeoff. Up to 1,500 images and 512 MB per request.

**Anthropic (native API):** Resizes images so the longest edge is 1,568px. Token cost = (width × height) / 750. However, this resizing does *not* appear to be applied when Claude models are invoked through Bedrock's Converse API.

**Google Gemini:** Tiles images into 768x768 segments at 258 tokens each, with a configurable `media_resolution` parameter.

### Bedrock Image Input Limits

Per-image size limits, maximum dimensions, and the number of images allowed per
request vary by model, so check the documentation for the model you are using
rather than assuming a fixed ceiling:

- [Models at a glance](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html) — per-model cards, including supported modalities and each model's quotas and limits
- [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html) — account-level service quotas
- [Inference using the Converse API](https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html) — the `ImageBlock` request shape

One structural limit does apply across models: an `ImageBlock` accepts raw image
bytes or an Amazon S3 location, so there is no HTTP URL pass-through. Compare to
OpenAI: 1,500 images, 512 MB per request, and native URL support.

### The Gap

The absence of server-side preprocessing requires customers to implement their own pipeline (resizing, tiling, compression) before sending images to Bedrock. This library fills that gap with client-side preprocessing that replicates what other providers do automatically.

Evidence from OpenAI's documentation indicates their preprocessing is implemented at the API/platform layer, not within the models themselves — suggesting Bedrock could implement equivalent functionality as a platform feature.

## Solution

This library preprocesses images before sending them to Bedrock, reducing each image to ~1,500-2,000 tokens while preserving visual quality for model inference.

| Scenario | Without preprocessing | With preprocessing |
|----------|----------------------|-------------------|
| 1 image (4000x3000) | ~30,000 tokens | ~1,600 tokens |
| 10 images (mixed sizes) | ~250,000 tokens | ~16,000 tokens |
| 15 images (4000x3000) | ~450,000 tokens | ~24,000 tokens |

### Target Scenario

- 10-15 images per request
- Total context budget: ~128K tokens (shared with text prompts and tool calls)
- Target: each image ≤ 2,000 tokens after preprocessing
- Current state (without preprocessing): each image consumes 20,000-40,000 tokens

## Preprocessing Modes

### Mode 1: Patch-Based (OpenAI models on Bedrock Mantle)

Replicates OpenAI's patch-based tokenization system:

1. Accepts images as Buffer, URL, base64, data URI, or S3 URI
2. Calculates patch count: `ceil(width/32) × ceil(height/32)`
3. Applies patch budgets based on detail level:
   - **Low:** Fixed 512×512 resize
   - **High:** Max 2,500 patches OR 2048px max dimension
   - **Original:** Max 10,000 patches OR 6000px max dimension
4. Resizes proportionally (preserving aspect ratio) to fit within BOTH constraints
5. Outputs as JPEG (quality 85) for photos, PNG for diagrams/screenshots
6. Returns metadata: original/resized dimensions, patch count, estimated tokens (patches × 1.62)

### Mode 2: Tile-Based (Anthropic models on Bedrock Runtime)

Adapted from OpenAI's tile system for Anthropic's token formula:

1. Scales image to fit within 2048×2048 (preserves aspect ratio)
2. Constrains longest edge to 1568px, shortest to 768px
3. Divides into 512×512 tiles
4. Optionally resizes to target a maximum token budget
5. Token formula: `(width × height) / 750`
6. Returns metadata: original/resized dimensions, tile count, estimated tokens

## Installation

This sample is **not** published to a package registry. Copy the `src/` module into
your project (or vendor this repository) and import it directly.

```bash
git clone https://github.com/aws-samples/sample-bedrock-image-preprocessor.git
cd sample-bedrock-image-preprocessor
npm install
npm run build
```

Requires Node.js >= 20.19.0 and `sharp` (installed automatically).

## Usage

### Batch Processing

```ts
preprocessImages(images: ImageInput[], options: PreprocessOptions): Promise<ProcessedImage[]>
```

- Accepts arrays of images (URLs, Buffers, base64 strings, or S3 URIs)
- For URLs: fetches the image first, then processes
- For S3 URIs: fetches via AWS SDK, then processes
- Applies the selected mode to each image
- `maxTotalTokens` option distributes a token budget across all images, reducing quality proportionally if the batch would exceed it

#### Patch Mode (OpenAI models on Bedrock Mantle)

```ts
import { preprocessImages } from './src/index.js';

const processed = await preprocessImages(images, {
  mode: 'patch',
  detail: 'high', // 'low' | 'high' | 'original'
  maxTotalTokens: 30000,
});

// Each processed image has:
// - base64: ready for API payload
// - mimeType: 'image/jpeg' or 'image/png'
// - metadata: { originalDimensions, resizedDimensions, patchCount, estimatedTokens }
```

#### Tile Mode (Anthropic models on Bedrock Runtime)

```ts
import { preprocessImages } from './src/index.js';

const processed = await preprocessImages(images, {
  mode: 'tile',
  maxTotalTokens: 30000,
});

// metadata includes: { originalDimensions, resizedDimensions, tileCount, estimatedTokens }
```

### Single Image Processing

```ts
import { preprocessPatchMode, preprocessTileMode } from './src/index.js';

// Patch mode
const result = await preprocessPatchMode(imageBuffer, { detail: 'high' });

// Tile mode
const result = await preprocessTileMode(imageBuffer, { maxTokenBudget: 2000 });
```

### AI SDK Integration

The library provides middleware that intercepts AI SDK messages containing image content, preprocesses them, and passes the optimized images to Bedrock.

```ts
import { createOpenAI } from '@ai-sdk/openai';
import { createImagePreprocessor } from './src/index.js';

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
const params = await preprocessor.transformParams({ messages });
```

#### How the AI SDK fits in

The AI SDK is **not** used in the demo application. The demo backend calls Bedrock directly via `@aws-sdk/client-bedrock-runtime` (ConverseCommand) to keep things simple and dependency-free.

The library exports `createImagePreprocessor` and `wrapLanguageModel` which are designed to integrate with the AI SDK — they transform message objects that match the AI SDK's shape. The `ai` package is listed as an optional peer dependency, not a hard requirement.

In a production application, the customer would use the middleware like this:

```ts
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel } from './src/index.js';

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
const result = await generateText({ model, messages });
```

The middleware intercepts `doGenerate` and `doStream` calls via a Proxy, preprocesses any image content parts, and forwards the optimized payload to the underlying model.

### Supported Input Types

| Type | Description |
|------|-------------|
| Buffer | Node.js Buffer object |
| URL | HTTP/HTTPS URLs (auto-fetched) |
| Base64 | Raw base64 string |
| Data URI | `data:image/...;base64,...` |
| S3 URI | `s3://bucket/key` |
| S3 Object | `{ bucket, key, region }` |

```ts
// Buffer
await preprocessPatchMode(buffer, { detail: 'high' });

// URL (fetched automatically)
await preprocessPatchMode('https://example.com/image.jpg', { detail: 'high' });

// Base64 string
await preprocessPatchMode(base64String, { detail: 'high' });

// Data URI
await preprocessPatchMode('data:image/png;base64,...', { detail: 'high' });

// S3 URI
await preprocessPatchMode('s3://bucket/key.jpg', { detail: 'high' });

// S3 object
await preprocessPatchMode({ bucket: 'my-bucket', key: 'image.jpg', region: 'us-east-1' }, { detail: 'high' });
```

### Fetching Remote Images Safely

URL and `s3://` inputs make the library issue an outbound request on your
process's behalf, using your process's IAM credentials. **If the input can be
influenced by an untrusted party, constrain it.** Pass a `fetch` option to any
of `preprocessImages`, `preprocessPatchMode`, `preprocessTileMode`, or
`createImagePreprocessor`:

```ts
await preprocessPatchMode(untrustedUrl, {
  detail: 'high',
  fetch: {
    // Reject loopback, link-local, and private space — including the
    // instance metadata endpoint at 169.254.169.254.
    blockPrivateNetworks: true,
    // Stronger still: only these hosts, whatever the input says.
    allowedHosts: ['images.example.com'],
    // For s3:// inputs, restrict which buckets may be read.
    allowedBuckets: ['my-approved-bucket'],
    timeoutMs: 5_000,
    maxBytes: 10 * 1024 * 1024,
    maxRedirects: 2,
  },
});
```

| Option | Default | Effect |
|--------|---------|--------|
| `timeoutMs` | `10000` | Total budget for the fetch, including redirects and body read |
| `maxBytes` | `26214400` (25 MiB) | Response is aborted once it exceeds this |
| `maxRedirects` | `3` | Redirects are followed manually, and **every hop is re-validated** |
| `blockPrivateNetworks` | `false` | Reject loopback, link-local, private, and reserved addresses |
| `allowedHosts` | *(unset)* | Exact-match hostname allowlist |
| `allowedBuckets` | *(unset)* | Bucket allowlist for `s3://` inputs |

The timeout, size cap, and redirect cap always apply. The three restriction
controls are opt-in, since a legitimate caller may be fetching from a private
image service — but a public-facing service that accepts user-supplied image
URLs should set them.

One limitation worth knowing: `blockPrivateNetworks` resolves the hostname and
checks every answer, but does not pin the resolved address for the connection,
so an attacker who controls a DNS server can still win that race (DNS
rebinding). Prefer `allowedHosts`, or enforce egress rules outside the process,
where the guarantee is real.

### Supported Image Formats

JPEG, PNG, WebP, GIF (first frame)

## Technical Constraints

- Uses `sharp` for image manipulation (fast, Lambda-compatible, no GUI dependencies)
- Handles EXIF rotation metadata (auto-orient before resizing)
- Each image is decoded fully in memory, so size your host or Lambda for the largest input you
  accept. Remote fetches are capped at 25 MiB by default (see
  [Fetching Remote Images Safely](#fetching-remote-images-safely)); buffers you pass in directly
  are not capped by the library.
- Error handling for corrupt images, unsupported formats, and network failures
- No canvas/browser dependencies — synchronous-safe for Lambda

## Deployment

The library runs anywhere Node.js >= 20.19.0 is available with native module support (for sharp).

### AWS Lambda

The primary deployment target. `sharp` ships Lambda-compatible prebuilt binaries. Package as a Lambda layer or bundle with your function.

```bash
# Install for Lambda (linux-x64)
npm install --platform=linux --arch=x64 sharp

# Bundle as a layer
mkdir -p layer/nodejs
cp -r node_modules layer/nodejs/
cd layer && zip -r ../layer.zip .
```

### EC2 / ECS / Fargate

No special configuration needed. Install dependencies and run as part of your existing service.

```bash
# This sample is not published to a package registry.
# Copy the src/ module into your project and import it directly.
```

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### Running the Demo Locally

```bash
# Clone and install
git clone https://github.com/aws-samples/sample-bedrock-image-preprocessor.git
cd sample-bedrock-image-preprocessor

# Install library dependencies
npm install

# Start the backend (port 3001)
cd demo/server && npm install && npm run dev

# In another terminal, start the frontend (port 5173)
cd demo/client && npm install && npm run dev

# Open http://localhost:5173
```

The demo works without AWS credentials for preprocessing comparison. Inference requires configured AWS credentials with Bedrock access.

Uploads are held in memory, so the demo backend caps a request at 8 images of 12 MB each
and rejects any image that decodes above 25 megapixels. Those limits are constants at the
top of `demo/server/index.ts` and `demo/server/lambda.ts`; raise them alongside the Lambda
`memorySize` in `demo/deploy/lib/stack.ts` if you need more.

The backend calls the Amazon Bedrock OpenAI-compatible Chat Completions endpoint
(`bedrock-mantle`) for OpenAI models and the Converse API for others. When running the
backend locally, the endpoint and path are configurable via environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | Port the local backend listens on |
| `AWS_REGION` | `us-east-1` | Region for Bedrock calls |
| `BEDROCK_OPENAI_ENDPOINT` | `https://bedrock-mantle.{region}.api.aws` | OpenAI-compatible endpoint base URL |
| `BEDROCK_OPENAI_BASE_PATH` | `/openai/v1` | Path prefix; set to `/v1` to match the docs for `bedrock-mantle` |

For the deployed stack, set the last two with CDK context instead — see
[Configuration reference](#configuration-reference) below. `AWS_REGION` is supplied
automatically by the Lambda runtime.

See the [Amazon Bedrock Chat Completions API docs](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions.html) for supported endpoints and paths.

### Deploying the Demo to Your Own AWS Account (optional)

The `demo/deploy` directory contains an AWS CDK app that deploys the demo as CloudFront +
API Gateway + Lambda + S3, protected by an invite-only Amazon Cognito user pool. Nothing
about the deployment is pre-configured — the stack targets whatever account and region your
own credentials resolve to.

> This is sample code, for non-production usage. You should work with your security and
> legal teams to meet your organizational security, regulatory, and compliance requirements
> before deployment.

#### Prerequisites

1. **Node.js >= 20.19.0** — `sharp` and the CDK app both require it. The Lambda runs on Node 24.
2. **AWS credentials** for the target account, with permission to create CloudFormation
   stacks, IAM roles, Lambda functions, S3 buckets, CloudFront distributions, API Gateway
   APIs, and Cognito user pools.
3. **A region that supports the models you want to use.** Bedrock vision models — and the
   OpenAI-compatible Chat Completions endpoint — are not available in every region.
   `us-east-1` and `us-west-2` have the broadest coverage. The stack itself deploys anywhere;
   inference will fail if the models are not offered locally.
4. **Bedrock model access enabled.** In the Bedrock console, open **Model access** and enable
   the vision models you intend to call. Without this, the stack deploys successfully, the
   model list populates, and inference then fails with `AccessDeniedException`.
5. **CDK bootstrapped in the target account and region** — once per account/region:

   ```bash
   npx cdk bootstrap aws://<account-id>/<region>
   ```

#### Deploy

The frontend reads its Cognito configuration at *build* time, and those values only exist
after the stack is created. The first deploy therefore stands up the infrastructure, and the
second ships a frontend that can actually sign in. Expect to run `cdk deploy` twice.

```bash
git clone https://github.com/aws-samples/sample-bedrock-image-preprocessor.git
cd sample-bedrock-image-preprocessor

# 1. Install dependencies. All three are required: the Lambda bundle resolves
#    @aws-sdk/client-s3 from the root and express/multer from demo/server.
npm install
cd demo/server && npm install && cd ../..
cd demo/client && npm install && cd ../..

# 2. Build the frontend and the linux-x64 sharp Lambda layer.
cd demo/client && npm run build && cd ../..
cd demo/deploy
npm install
npm run build:layer

# 3. First deploy — creates the stack and prints the outputs.
npx cdk deploy
```

Copy the `UserPoolId` and `UserPoolClientId` from the stack outputs into the frontend
configuration, then rebuild and redeploy:

```bash
cd ../client
cp .env.example .env.production
# edit .env.production and fill in both values from the stack outputs
npm run build
cd ../deploy
npx cdk deploy               # 4. Second deploy — ships the configured frontend
```

Open the `DistributionUrl` from the outputs. Self-signup is disabled, so create the first
user yourself:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username you@example.com \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL
```

Cognito emails a temporary password; the app prompts for a permanent one on first sign-in.
Leave self-signup disabled unless you intend the deployment to be open to anyone who finds
the URL.

#### Configuration reference

| Setting | How to pass it | Default |
|---------|----------------|---------|
| Target account | `-c account=<id>`, else `CDK_DEFAULT_ACCOUNT` from your credentials | your current credentials |
| Target region | `-c region=<region>`, else `CDK_DEFAULT_REGION` from your credentials | your current credentials |
| `VITE_USER_POOL_ID` | `demo/client/.env.production`, read at frontend build time | none — must be set |
| `VITE_USER_POOL_CLIENT_ID` | `demo/client/.env.production`, read at frontend build time | none — must be set |
| Bedrock OpenAI endpoint | `-c bedrockOpenAiEndpoint=<url>` | `https://bedrock-mantle.{region}.api.aws` |
| Bedrock OpenAI base path | `-c bedrockOpenAiBasePath=<path>` | `/openai/v1` |

The frontend calls the API on relative `/api/*` paths, which CloudFront proxies to API
Gateway on the same origin. There is no API URL to configure.

#### Teardown

```bash
cd demo/deploy && npm run destroy
```

The access-logs bucket is created with a `RETAIN` removal policy so the audit trail outlives
the stack, so `destroy` deliberately leaves it behind. Delete it manually to avoid ongoing
storage charges.

### Not Supported

- Browsers (sharp requires native binaries)
- CloudFront Functions / Lambda@Edge with <50MB limit
- Cloudflare Workers (no native module support)

## API Reference

| Function | Description |
|----------|-------------|
| `preprocessPatchMode(input, options)` | Process a single image using OpenAI-style patch budgets |
| `preprocessTileMode(input, options)` | Process a single image using Anthropic-style tile constraints |
| `preprocessImages(images, options)` | Batch process multiple images with optional total token budget |
| `createImagePreprocessor(options)` | Create a middleware object with `transformParams()` for AI SDK integration |
| `wrapLanguageModel(model, options)` | Wrap an AI SDK language model to auto-preprocess images |

## Running Tests

```bash
npm install
npm test
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for how to report a security issue.

This is sample code. Before using any part of it beyond experimentation:

- **Scope IAM permissions.** The demo Lambda is granted `bedrock:InvokeModel` and
  `bedrock:ListFoundationModels` on `*` so the user can pick any vision model at runtime.
  Restrict these to the specific model ARNs you intend to use.
- **Review the auth model.** The demo uses an invite-only Cognito user pool as a simple gate.
  Evaluate whether it meets your own authentication and authorization requirements.
- **Mind image sources.** URL and S3 inputs cause the library to fetch remote content, using
  your process's own network position and IAM credentials — an unguarded fetch of an
  attacker-supplied URL is server-side request forgery (SSRF), and an unguarded `s3://` read is
  a confused-deputy problem. A timeout, size cap, and redirect cap always apply; set
  `blockPrivateNetworks`, `allowedHosts`, and `allowedBuckets` whenever the input is not fully
  trusted. See [Fetching Remote Images Safely](#fetching-remote-images-safely).
- **Costs.** Running inference against Bedrock incurs charges. The deployable demo creates
  billable AWS resources (CloudFront, Lambda, API Gateway, S3, Cognito).

## License

This library is licensed under the MIT-0 License. See the [LICENSE](LICENSE) file.
