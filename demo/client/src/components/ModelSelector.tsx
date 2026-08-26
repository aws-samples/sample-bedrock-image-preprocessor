// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useEffect, useState } from 'react';
import { VisionModel } from '../types';

interface Props {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  getIdToken: () => Promise<string | null>;
}

export function ModelSelector({ selectedModel, onModelChange, getIdToken }: Props) {
  const [models, setModels] = useState<VisionModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      const headers: Record<string, string> = {};
      // The API Gateway Cognito authorizer expects the standard bearer scheme.
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/models', { headers });
      if (!res.ok) throw new Error('Failed to fetch models');
      const data = await res.json();
      setModels(data.models);
      if (data.models.length > 0 && !selectedModel) {
        onModelChange(data.models[0].modelId);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'Failed to load models');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  if (error) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Model</label>
        <div className="flex items-center gap-2">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={fetchModels}
            className="text-sm text-blue-600 hover:underline"
          >
            Retry
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Make sure AWS credentials are configured and the server is running.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">Model</label>
      <div className="flex items-center gap-2">
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={loading}
          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm p-2 border"
        >
          {loading && <option>Loading models...</option>}
          {(() => {
            const grouped: Record<string, VisionModel[]> = {};
            models.forEach((m) => {
              if (!grouped[m.provider]) grouped[m.provider] = [];
              grouped[m.provider].push(m);
            });
            return Object.entries(grouped).map(([provider, providerModels]) => (
              <optgroup key={provider} label={provider}>
                {providerModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.name} ({m.modelId})
                  </option>
                ))}
              </optgroup>
            ));
          })()}
        </select>
        <button
          onClick={fetchModels}
          disabled={loading}
          className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 disabled:opacity-50"
          title="Refresh model list"
        >
          ↻
        </button>
      </div>
      {models.length > 0 && (
        <p className="text-xs text-gray-500">
          {models.length} vision-capable model{models.length !== 1 ? 's' : ''} available
          — OpenAI models use the Bedrock Mantle endpoint, others use the Converse API
        </p>
      )}
    </div>
  );
}
