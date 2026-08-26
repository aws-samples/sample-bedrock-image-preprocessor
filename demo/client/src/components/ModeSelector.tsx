// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { PreprocessMode } from '../types';

interface Props {
  mode: PreprocessMode;
  onModeChange: (mode: PreprocessMode) => void;
}

const MODES: { value: PreprocessMode; label: string; description: string; detail: string }[] = [
  {
    value: 'patch-low',
    label: 'Patch — Low (smallest, lowest quality)',
    description: 'Maximum token savings at the cost of visual detail.',
    detail: 'Resizes every image to a fixed 512x512 (256 patches = ~415 tokens). Use when you need to fit many images in a single request and fine detail is not critical.',
  },
  {
    value: 'patch-high',
    label: 'Patch — High (recommended)',
    description: 'Best balance of quality and token savings for OpenAI models on Bedrock Mantle.',
    detail: 'Resizes images to fit within 2,500 patches (ceil(w/32) x ceil(h/32)) and a 2048px max dimension. Typically reduces a 4000x3000 image to ~1,600 tokens while preserving enough detail for model comprehension.',
  },
  {
    value: 'tile',
    label: 'Tile (Anthropic)',
    description: 'Optimized for Anthropic Claude models on Bedrock Runtime.',
    detail: 'Applies Anthropic\'s native constraints: longest edge capped at 1568px, shortest at 768px. Token cost calculated as (width x height) / 750. This matches what Anthropic would do server-side, but applied before upload to give you control over the budget.',
  },
  {
    value: 'patch-original',
    label: 'Patch — Original (highest quality)',
    description: 'Preserves maximum detail with minimal resizing.',
    detail: 'Allows up to 10,000 patches and 6000px max dimension. Only resizes images that exceed these generous limits. Higher token cost (~5,000-16,000 per image) but retains fine-grained visual information.',
  },
];

export function ModeSelector({ mode, onModeChange }: Props) {
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">
        Preprocessing Mode
      </label>
      <select
        value={mode}
        onChange={(e) => onModeChange(e.target.value as PreprocessMode)}
        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm p-2 border"
      >
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {(() => {
        const selected = MODES.find((m) => m.value === mode);
        if (!selected) return null;
        return (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-md">
            <p className="text-sm font-medium text-blue-800">{selected.description}</p>
            <p className="text-xs text-blue-600 mt-1">{selected.detail}</p>
          </div>
        );
      })()}
    </div>
  );
}
