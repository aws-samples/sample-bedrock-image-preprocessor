// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { ProcessResponse, RawProcessResponse } from '../types';
import { ContextWindowBar } from './ContextWindowBar';

interface Props {
  processedResult: ProcessResponse | null;
  rawResult: RawProcessResponse | null;
  loading: boolean;
  contextLimit: number;
}

export function ResultsPanel({ processedResult, rawResult, loading, contextLimit }: Props) {
  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        <div className="animate-pulse">Processing images...</div>
      </div>
    );
  }

  if (!processedResult && !rawResult) return null;

  const rawTokens = rawResult?.totals.estimatedTokensRaw
    ?? processedResult?.totals.estimatedTokensBefore
    ?? 0;
  const processedTokens = processedResult?.totals.estimatedTokensAfter ?? null;

  return (
    <div className="space-y-6">
      <ContextWindowBar
        rawTokens={rawTokens}
        processedTokens={processedTokens}
        contextLimit={contextLimit}
      />

      {(processedResult?.images || rawResult?.images) && (
        <ImageBreakdown
          processedResult={processedResult}
          rawResult={rawResult}
        />
      )}

      {processedResult?.totals && (
        <TokenTotals totals={processedResult.totals} />
      )}

      {rawResult && (
        <InferenceBox
          title="Raw Inference (without preprocessing)"
          inference={rawResult.inference}
          error={rawResult.error}
          variant="raw"
        />
      )}

      {processedResult && (
        <InferenceBox
          title="Preprocessed Inference"
          inference={processedResult.inference}
          error={processedResult.error}
          variant="processed"
          preprocessingMs={processedResult.preprocessingMs}
        />
      )}
    </div>
  );
}

function ImageBreakdown({
  processedResult,
  rawResult,
}: {
  processedResult: ProcessResponse | null;
  rawResult: RawProcessResponse | null;
}) {
  const images = processedResult?.images ?? rawResult?.images ?? [];

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b">
        <h3 className="text-sm font-medium text-gray-700">Per-Image Breakdown</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-4 py-2 text-left">Image</th>
              <th className="px-4 py-2 text-left">Original</th>
              <th className="px-4 py-2 text-left">Preprocessed</th>
              <th className="px-4 py-2 text-right">Savings</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {images.map((img, i) => {
              const savings = img.processed
                ? Math.round((1 - img.processed.estimatedTokens / img.original.estimatedTokens) * 100)
                : null;
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-800 truncate max-w-[150px]">{img.filename}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-gray-600">{img.original.width}x{img.original.height}</div>
                    <div className="text-xs text-gray-400">
                      Est: {img.original.estimatedTokens.toLocaleString()} tokens
                    </div>
                    <div className="text-xs text-gray-400">
                      {(img.original.sizeBytes / 1024).toFixed(0)} KB
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {img.processed ? (
                      <>
                        <div className="text-gray-600">{img.processed.width}x{img.processed.height}</div>
                        <div className="text-xs text-green-600">
                          Est: {img.processed.estimatedTokens.toLocaleString()} tokens
                        </div>
                        <div className="text-xs text-gray-400">
                          {(img.processed.sizeBytes / 1024).toFixed(0)} KB
                        </div>
                      </>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {savings !== null ? (
                      <span className="text-green-600 font-medium">{savings}%</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TokenTotals({ totals }: { totals: ProcessResponse['totals'] }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-2 border-b">
        <h3 className="text-sm font-medium text-gray-700">Token Totals — Estimated vs. Actual</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="px-4 py-2 text-left"></th>
            <th className="px-4 py-2 text-right">Estimated (formula)</th>
            <th className="px-4 py-2 text-right">Actual (API response)</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr>
            <td className="px-4 py-2 text-gray-600">Raw (before)</td>
            <td className="px-4 py-2 text-right font-mono">
              {totals.estimatedTokensBefore.toLocaleString()}
            </td>
            <td className="px-4 py-2 text-right text-gray-400">— (overflow / N/A)</td>
          </tr>
          <tr>
            <td className="px-4 py-2 text-gray-600">After preprocessing</td>
            <td className="px-4 py-2 text-right font-mono">
              {totals.estimatedTokensAfter.toLocaleString()}
            </td>
            <td className="px-4 py-2 text-right font-mono">
              {totals.actualTokens?.toLocaleString() ?? '—'}
            </td>
          </tr>
          {totals.estimateErrorPercent !== null && (
            <tr>
              <td className="px-4 py-2 text-gray-600">Estimate accuracy</td>
              <td className="px-4 py-2"></td>
              <td className="px-4 py-2 text-right text-xs text-gray-500">
                {totals.estimateErrorPercent > 0 ? '+' : ''}
                {totals.estimateErrorPercent}% vs estimate
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function InferenceBox({
  title,
  inference,
  error,
  variant,
  preprocessingMs,
}: {
  title: string;
  inference: ProcessResponse['inference'] | null;
  error: ProcessResponse['error'] | null;
  variant: 'raw' | 'processed';
  preprocessingMs?: number;
}) {
  const borderColor = variant === 'raw' ? 'border-red-200' : 'border-green-200';
  const headerBg = variant === 'raw' ? 'bg-red-50' : 'bg-green-50';

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      <div className={`px-4 py-2 border-b ${borderColor} ${headerBg}`}>
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
      </div>
      <div className="p-4">
        {error && (
          <div className="text-red-600">
            <span className="font-medium">Error: {error.code}</span>
            <p className="text-sm mt-1">{error.message}</p>
          </div>
        )}
        {inference && (
          <div className="space-y-2">
            <p className="text-gray-800 whitespace-pre-wrap">{inference.response}</p>
            <div className="text-xs text-gray-500 flex gap-4 pt-2 border-t">
              <span>Input: {inference.inputTokens.toLocaleString()} tokens</span>
              <span>Output: {inference.outputTokens.toLocaleString()} tokens</span>
              <span>Latency: {(inference.latencyMs / 1000).toFixed(1)}s</span>
              {preprocessingMs !== undefined && (
                <span>Preprocessing: {preprocessingMs}ms</span>
              )}
            </div>
          </div>
        )}
        {!error && !inference && (
          <p className="text-gray-400 text-sm">No result yet</p>
        )}
      </div>
    </div>
  );
}
