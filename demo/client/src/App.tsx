// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState } from 'react';
import { ImageUpload } from './components/ImageUpload';
import { ModelSelector } from './components/ModelSelector';
import { ModeSelector } from './components/ModeSelector';
import { ResultsPanel } from './components/ResultsPanel';
import { HomePage } from './components/HomePage';
import { DocsPage } from './components/DocsPage';
import { PreprocessMode, ProcessResponse, RawProcessResponse } from './types';

type Tab = 'home' | 'demo' | 'docs';

interface AppProps {
  onSignOut: () => void;
  getIdToken: () => Promise<string | null>;
}

function App({ onSignOut, getIdToken }: AppProps) {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [files, setFiles] = useState<File[]>([]);
  const [modelId, setModelId] = useState('');
  const [mode, setMode] = useState<PreprocessMode>('patch-high');
  const [prompt, setPrompt] = useState('Describe what you see in these images.');
  const [loading, setLoading] = useState(false);
  const [processedResult, setProcessedResult] = useState<ProcessResponse | null>(null);
  const [rawResult, setRawResult] = useState<RawProcessResponse | null>(null);

  const contextLimit = 128000;

  const authFetch = async (url: string, init: RequestInit) => {
    const token = await getIdToken();
    const headers = new Headers(init.headers);
    // The API Gateway Cognito authorizer expects the standard bearer scheme.
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const buildFormData = () => {
    const formData = new FormData();
    files.forEach((f) => formData.append('images', f));
    formData.append('mode', mode);
    formData.append('modelId', modelId);
    formData.append('prompt', prompt);
    return formData;
  };

  const handleProcessed = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setProcessedResult(null);
    try {
      const endpoint = modelId ? '/api/process' : '/api/preprocess-only';
      const res = await authFetch(endpoint, {
        method: 'POST',
        body: buildFormData(),
      });
      const data = await res.json();
      if (!modelId) {
        const estimatedBefore = data.images.reduce((s: number, img: { original: { estimatedTokens: number } }) => s + img.original.estimatedTokens, 0);
        const estimatedAfter = data.images.reduce((s: number, img: { original: { estimatedTokens: number }; processed?: { estimatedTokens: number } }) => s + (img.processed?.estimatedTokens ?? img.original.estimatedTokens), 0);
        setProcessedResult({
          images: data.images,
          inference: null,
          error: null,
          totals: {
            estimatedTokensBefore: estimatedBefore,
            estimatedTokensAfter: estimatedAfter,
            actualTokens: null,
            estimateErrorPercent: null,
          },
          preprocessingMs: data.preprocessingMs,
        });
      } else {
        setProcessedResult(data);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setProcessedResult({
        images: [],
        inference: null,
        error: { code: 'network_error', message: e.message ?? 'Request failed' },
        totals: { estimatedTokensBefore: 0, estimatedTokensAfter: 0, actualTokens: null, estimateErrorPercent: null },
        preprocessingMs: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRaw = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setRawResult(null);
    try {
      if (modelId) {
        const res = await authFetch('/api/process-raw', {
          method: 'POST',
          body: buildFormData(),
        });
        const data = await res.json();
        setRawResult(data);
      } else {
        const res = await authFetch('/api/preprocess-only', {
          method: 'POST',
          body: buildFormData(),
        });
        const data = await res.json();
        const estimatedRaw = data.images.reduce((s: number, img: { original: { estimatedTokens: number } }) => s + img.original.estimatedTokens, 0);
        setRawResult({
          images: data.images,
          inference: null,
          error: null,
          totals: { estimatedTokensRaw: estimatedRaw, actualTokens: null },
        });
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setRawResult({
        images: [],
        inference: null,
        error: { code: 'network_error', message: e.message ?? 'Request failed' },
        totals: { estimatedTokensRaw: 0, actualTokens: null },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBoth = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setRawResult(null);
    setProcessedResult(null);

    if (modelId) {
      const [rawRes, processedRes] = await Promise.allSettled([
        authFetch('/api/process-raw', { method: 'POST', body: buildFormData() }),
        authFetch('/api/process', { method: 'POST', body: buildFormData() }),
      ]);

      if (rawRes.status === 'fulfilled') {
        setRawResult(await rawRes.value.json());
      }
      if (processedRes.status === 'fulfilled') {
        setProcessedResult(await processedRes.value.json());
      }
    } else {
      const [rawRes, processedRes] = await Promise.allSettled([
        authFetch('/api/preprocess-only', { method: 'POST', body: buildFormData() }),
        authFetch('/api/preprocess-only', { method: 'POST', body: buildFormData() }),
      ]);

      if (rawRes.status === 'fulfilled') {
        const data = await rawRes.value.json();
        const estimatedRaw = data.images.reduce((s: number, img: { original: { estimatedTokens: number } }) => s + img.original.estimatedTokens, 0);
        setRawResult({
          images: data.images,
          inference: null,
          error: null,
          totals: { estimatedTokensRaw: estimatedRaw, actualTokens: null },
        });
      }
      if (processedRes.status === 'fulfilled') {
        const data = await processedRes.value.json();
        const estimatedBefore = data.images.reduce((s: number, img: { original: { estimatedTokens: number } }) => s + img.original.estimatedTokens, 0);
        const estimatedAfter = data.images.reduce((s: number, img: { original: { estimatedTokens: number }; processed?: { estimatedTokens: number } }) => s + (img.processed?.estimatedTokens ?? img.original.estimatedTokens), 0);
        setProcessedResult({
          images: data.images,
          inference: null,
          error: null,
          totals: {
            estimatedTokensBefore: estimatedBefore,
            estimatedTokensAfter: estimatedAfter,
            actualTokens: null,
            estimateErrorPercent: null,
          },
          preprocessingMs: data.preprocessingMs,
        });
      }
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <h1 className="text-lg font-bold text-gray-900">
              Bedrock Image Preprocessor
            </h1>
            <div className="flex gap-1 items-center">
              <button
                onClick={() => setActiveTab('home')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'home'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Home
              </button>
              <button
                onClick={() => setActiveTab('demo')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'demo'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Demo
              </button>
              <button
                onClick={() => setActiveTab('docs')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === 'docs'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                Docs
              </button>
              <div className="w-px h-6 bg-gray-200 mx-2" />
              <button
                onClick={onSignOut}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {activeTab === 'home' && <HomePage />}

        {activeTab === 'docs' && <DocsPage />}

        {activeTab === 'demo' && (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-900">Interactive Demo</h2>
              <p className="text-gray-600 text-sm mt-1">
                Upload images to compare raw vs. preprocessed token consumption and inference results.
              </p>
            </div>

            <div className="space-y-6 bg-white p-6 rounded-lg shadow-sm border">
              <ModelSelector selectedModel={modelId} onModelChange={setModelId} getIdToken={getIdToken} />

              <ImageUpload files={files} onFilesChange={setFiles} />

              <ModeSelector mode={mode} onModeChange={setMode} />

              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">Prompt</label>
                <input
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm p-2 border"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleRaw}
                  disabled={files.length === 0 || loading}
                  className="px-4 py-2 text-sm font-medium text-red-700 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send Without Preprocessing
                </button>
                <button
                  onClick={handleProcessed}
                  disabled={files.length === 0 || loading}
                  className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Send With Preprocessing
                </button>
                <button
                  onClick={handleBoth}
                  disabled={files.length === 0 || loading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Compare Both
                </button>
              </div>
              {!modelId && (
                <p className="text-xs text-gray-500">
                  No model selected — comparison will show estimated token counts only (no inference).
                </p>
              )}
            </div>

            <div className="mt-8">
              <ResultsPanel
                processedResult={processedResult}
                rawResult={rawResult}
                loading={loading}
                contextLimit={contextLimit}
              />
            </div>
          </>
        )}
      </main>

      <footer className="border-t mt-16 py-4 text-center text-xs text-gray-400">
        AWS sample — provided for demonstration purposes, not for production use.
      </footer>
    </div>
  );
}

export default App;
