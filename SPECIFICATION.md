# Bedrock Image Preprocessor — Project Specification

## Overview

A client-side image preprocessing library and demo application for AWS Bedrock inference requests. The library replicates OpenAI's server-side image optimization to reduce token consumption by 10-20x, enabling multi-image inference requests that would otherwise overflow the context window.

## Problem Statement

AWS Bedrock passes raw base64 images directly to models without preprocessing. A customer sends 10-15 images per inference request and hits context overflow at 5-6 images (~200K+ tokens). OpenAI performs this optimization server-side, but Bedrock does not.

**Before preprocessing:** 1 image (4000x3000) = ~30,000 tokens
**After preprocessing:** 1 image (4000x3000) = ~1,600 tokens

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                       │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Image   │  │  Preprocess  │  │   Results Display     │  │
│  │  Upload  │  │  Options     │  │   - Before/After      │  │
│  │          │  │  Dropdown    │  │   - Token counts      │  │
│  └────┬─────┘  └──────┬───────┘  │   - Model response    │  │
│       │                │          └───────────────────────┘  │
│       └────────┬───────┘                                     │
└────────────────┼─────────────────────────────────────────────┘
                 │ POST /api/process (multipart/form-data)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Express)                         │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Upload        │  │  Preprocess  │  │  Bedrock       │  │
│  │  Handler       │──▶  Engine      │──▶  Inference     │  │
│  │  (multer)      │  │  (sharp)     │  │  (AWS SDK)     │  │
│  └────────────────┘  └──────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                                    ┌───────────────────┐
                                    │  AWS Bedrock      │
                                    │  (Mantle or       │
                                    │   Runtime API)    │
                                    └───────────────────┘
```

---

## Component 1: Preprocessing Library (`src/`)

### Responsibilities
- Accept images as Buffer, URL, base64, data URI, or S3 URI
- Resize/optimize based on selected preprocessing mode
- Return processed base64 + metadata (dimensions, token estimates)

### Preprocessing Modes

| Mode | Target Model | Strategy | Token Formula |
|------|-------------|----------|---------------|
| Patch — Low | OpenAI on Mantle | Fixed 512×512 | patches × 1.62 |
| Patch — High | OpenAI on Mantle | Max 2500 patches / 2048px | patches × 1.62 |
| Patch — Original | OpenAI on Mantle | Max 10000 patches / 6000px | patches × 1.62 |
| Tile | Anthropic on Runtime | 1568px long edge, 768px short | (w × h) / 750 |
| None (passthrough) | Any | No resize, raw base64 | Raw pixel calculation |

### Technical Details
- Image library: `sharp` (Lambda-compatible, no GUI deps)
- Supported formats: JPEG, PNG, WebP, GIF (first frame)
- Auto-orient via EXIF metadata before resizing
- Output format: auto-detect (JPEG quality 85 for photos, PNG for diagrams)

---

## Component 2: Demo Application

### Purpose
A local web application to visually demonstrate preprocessing effects and run real Bedrock inference with preprocessed images.

### Frontend (React + Vite)

#### Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Bedrock Image Preprocessor Demo                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Model: [ anthropic.claude-sonnet-4-20250514 ▼ ]  [↻ Refresh]  │
│         (fetched from account's available models)               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐              [ + Add ]     │   │
│  │  │ img1 │ │ img2 │ │ img3 │   Drop files or click      │   │
│  │  └──────┘ └──────┘ └──────┘                             │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Preprocessing Mode: [ Patch — High (recommended) ▼ ]          │
│                                                                 │
│  Prompt: [Describe what you see in these images          ]     │
│                                                                 │
│  [ Send Without Preprocessing ]  [ Send With Preprocessing ]   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Results — Comparison                                           │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Context Window Usage                    128K limit      │   │
│  │  ████████████████████████████████░░░░  Raw: 187K  OVER! │   │
│  │  ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  Processed: 14K   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────── Per-Image Breakdown ──────────────────────┐   │
│  │  Image    Original     Preprocessed   Savings           │   │
│  │  img1.jpg 4000×3000    1536×1152      95%               │   │
│  │           Est: 31,250  Est: 1,620                       │   │
│  │           Act: —       Act: 1,843                       │   │
│  │                                                         │   │
│  │  img2.png 2048×1536    1568×1176      89%               │   │
│  │           Est: 16,128  Est: 1,240                       │   │
│  │           Act: —       Act: 1,402                       │   │
│  │                                                         │   │
│  │  img3.jpg 5000×4000    1536×1229      97%               │   │
│  │           Est: 40,625  Est: 1,580                       │   │
│  │           Act: —       Act: 1,720                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Token Totals:                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │        │ Estimated (formula)  │ Actual (API response)   │   │
│  │  Raw   │ 88,003 tokens        │ — (overflow / N/A)      │   │
│  │  After │  4,440 tokens        │ 4,965 tokens            │   │
│  │  Error │                      │ +11.8% vs estimate      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Raw Inference Result                                    │   │
│  │  ❌ Error: context_length_exceeded — 187,503 tokens     │   │
│  │     exceeds maximum of 128,000                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Preprocessed Inference Result                           │   │
│  │  ✓ "These images show a series of landscape..."         │   │
│  │  Input: 4,965 tokens | Output: 312 tokens | 2.4s       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Features
- **Multi-image upload** with drag-and-drop zone and thumbnails
- File picker accepting JPEG, PNG, WebP, GIF (multiple selection)
- Model selector populated from account's available Bedrock vision models
- Dropdown for preprocessing mode selection
- Text input for inference prompt (default provided)
- **Two inference buttons**: raw (to demonstrate overflow) and preprocessed
- **Context window visualization**: bar showing usage vs. model limit
- Per-image breakdown table with estimated AND actual token counts
- Token totals comparing formula estimates vs. API-reported actuals
- Error % showing how close the estimate is to reality
- **Overflow demonstration**: raw sends images without preprocessing to show the context_length_exceeded error
- Model response display for both attempts
- Processing and inference timing

#### Tech Stack
- React 18 with TypeScript
- Vite for bundling and dev server
- Tailwind CSS for styling
- No additional UI framework (keep it simple)

### Backend (Express)

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/models` | List vision-capable models available in the user's Bedrock account |
| POST | `/api/process` | Upload images, preprocess, run inference |
| POST | `/api/process-raw` | Upload images WITHOUT preprocessing, run inference (to demonstrate overflow) |
| POST | `/api/preprocess-only` | Upload images, preprocess, return metadata (no inference) |
| GET | `/api/health` | Health check |

#### `GET /api/models`

Returns vision-capable models available in the user's Bedrock account. Calls `ListFoundationModels` filtered by `inputModality: IMAGE`.

**Response:**
```json
{
  "models": [
    {
      "modelId": "anthropic.claude-sonnet-4-20250514",
      "name": "Claude Sonnet 4",
      "provider": "Anthropic",
      "contextWindow": 200000,
      "inputModalities": ["TEXT", "IMAGE"]
    },
    {
      "modelId": "us.anthropic.claude-sonnet-4-20250514-v1:0",
      "name": "Claude Sonnet 4 (cross-region)",
      "provider": "Anthropic",
      "contextWindow": 200000,
      "inputModalities": ["TEXT", "IMAGE"]
    },
    {
      "modelId": "amazon.nova-pro-v1:0",
      "name": "Amazon Nova Pro",
      "provider": "Amazon",
      "contextWindow": 300000,
      "inputModalities": ["TEXT", "IMAGE", "VIDEO"]
    }
  ]
}
```

#### `POST /api/process`

**Request:** `multipart/form-data`
- `images` — one or more uploaded files (multi-file field)
- `mode` — preprocessing mode (`patch-low`, `patch-high`, `patch-original`, `tile`, `none`)
- `modelId` — Bedrock model ID selected by the user
- `prompt` — text prompt for the model (optional, default: "Describe what you see in these images")

**Response:**
```json
{
  "images": [
    {
      "filename": "photo1.jpg",
      "original": {
        "width": 4000,
        "height": 3000,
        "sizeBytes": 2400000,
        "estimatedTokens": 31250
      },
      "processed": {
        "width": 1536,
        "height": 1152,
        "sizeBytes": 142000,
        "estimatedTokens": 1620,
        "base64Preview": "data:image/jpeg;base64,..."
      }
    }
  ],
  "inference": {
    "response": "These images show...",
    "model": "anthropic.claude-sonnet-4-20250514",
    "inputTokens": 4965,
    "outputTokens": 312,
    "latencyMs": 2400
  },
  "totals": {
    "estimatedTokensBefore": 88003,
    "estimatedTokensAfter": 4440,
    "actualTokens": 4965,
    "estimateErrorPercent": 11.8
  },
  "preprocessingMs": 340
}
```

#### `POST /api/process-raw`

Same request format as `/api/process` but sends images to Bedrock WITHOUT preprocessing. This deliberately demonstrates context overflow when too many large images are sent.

**Response (success — few/small images):**
```json
{
  "images": [...],
  "inference": {
    "response": "...",
    "inputTokens": 187503,
    "outputTokens": 256,
    "latencyMs": 5200
  }
}
```

**Response (overflow):**
```json
{
  "images": [...],
  "inference": null,
  "error": {
    "code": "context_length_exceeded",
    "message": "Input token count 187,503 exceeds maximum of 128,000",
    "totalTokensAttempted": 187503,
    "modelContextWindow": 128000
  }
}
```

#### `POST /api/preprocess-only`

Same request as `/api/process`, returns per-image `original` and `processed` fields only (no inference call). Works without AWS Bedrock access for the inference step — only needs credentials if images are from S3.

#### Configuration

Environment variables:
- `AWS_REGION` — Bedrock region (default: `us-east-1`)
- `PORT` — Server port (default: `3001`)

#### Tech Stack
- Express.js with TypeScript
- multer for file upload handling
- AWS SDK v3 (`@aws-sdk/client-bedrock-runtime`)
- The preprocessing library (local import)

---

## Component 3: Test Suite

### Unit Tests (existing, `tests/`)
- Patch mode at each detail level
- Tile mode with and without token budget
- Batch processing with 15 images
- Input type resolution (Buffer, URL, base64, S3)
- Output format auto-detection

### Integration Tests (new, `demo/tests/`)
- API endpoint: upload + preprocess returns correct metadata
- API endpoint: preprocess-only mode works without AWS credentials
- Frontend: file upload renders preview
- Frontend: dropdown changes mode
- End-to-end: upload → preprocess → display results

---

## Directory Structure

```
bedrock-image-preprocessor/
├── src/                        # Preprocessing library
│   ├── index.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── patch-mode.ts
│   ├── tile-mode.ts
│   ├── batch.ts
│   └── middleware.ts
├── tests/                      # Library unit tests
│   ├── helpers.ts
│   ├── patch-mode.test.ts
│   ├── tile-mode.test.ts
│   ├── batch.test.ts
│   └── utils.test.ts
├── demo/                       # Demo application
│   ├── server/                 # Express backend
│   │   ├── index.ts
│   │   ├── routes.ts
│   │   └── bedrock-client.ts
│   ├── client/                 # React frontend
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── ImageUpload.tsx
│   │   │   │   ├── ModeSelector.tsx
│   │   │   │   ├── ResultsPanel.tsx
│   │   │   │   └── TokenComparison.tsx
│   │   │   └── types.ts
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   └── package.json
│   └── tests/
│       └── api.test.ts
├── examples/                   # Standalone usage examples
│   └── bedrock-mantle.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── SPECIFICATION.md
└── README.md
```

---

## Running the Demo

```bash
# 1. Install dependencies
npm install
cd demo/client && npm install

# 2. Start the backend (port 3001)
cd demo/server && npx tsx index.ts

# 3. Start the frontend (port 5173, proxies API to 3001)
cd demo/client && npm run dev

# 4. Open http://localhost:5173
```

### Without AWS Credentials
The `/api/preprocess-only` endpoint works without credentials, so preprocessing visualization and token comparison can be tested locally without a Bedrock connection. The inference step will be skipped and show a placeholder message.

---

## Token Budget Reference

Target for the customer scenario:
- 10-15 images per request
- Total context: ~128K tokens (shared with text + tools)
- Target per image: ≤ 2,000 tokens after preprocessing
- Current state (raw): 20,000-40,000 tokens per image

---

## Token Estimation vs. Actual — Design Notes

The library uses provider-published formulas to estimate tokens from image dimensions:
- **Patch mode (OpenAI):** `ceil(width/32) × ceil(height/32) × 1.62`
- **Tile mode (Anthropic):** `(width × height) / 750`

These are approximations. Actual token counts come only from the API response `usage` field. The demo shows both side-by-side so users can:
1. See how close the estimate is (typically within 10-15%)
2. Understand the fixed per-image overhead not captured by the formula (~50 tokens for Anthropic)
3. Trust the estimate for budget planning while knowing the actual may differ slightly

The "estimate error %" displayed in the UI is: `((actual - estimated) / estimated) × 100`

---

## Multi-Image Overflow Demonstration

The "Send Without Preprocessing" button is the key demo feature. It deliberately sends all images raw to Bedrock to provoke the `context_length_exceeded` error. This makes the value of preprocessing viscerally clear:

1. User uploads 10-15 images
2. Clicks "Send Without Preprocessing" → sees the error with actual token count attempted
3. Clicks "Send With Preprocessing" → sees successful response with 95%+ reduction
4. Context window bar shows both states visually

---

## Future Considerations

- **Real-time preview** — show preprocessing effect as user adjusts options (live resize)
- **Cost calculator** — show dollar cost difference based on model pricing
- **S3 integration** — allow S3 URI input in the demo UI
- **Deployment template** — CDK/SAM template for Lambda + API Gateway
- **Streaming responses** — show model output as it streams back
- **History** — persist past runs to compare across models/modes
