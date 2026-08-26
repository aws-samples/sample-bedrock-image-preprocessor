// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
interface Props {
  rawTokens: number;
  processedTokens: number | null;
  contextLimit: number;
}

export function ContextWindowBar({ rawTokens, processedTokens, contextLimit }: Props) {
  const rawPercent = Math.min((rawTokens / contextLimit) * 100, 100);
  const processedPercent = processedTokens !== null
    ? Math.min((processedTokens / contextLimit) * 100, 100)
    : null;
  const rawOverflow = rawTokens > contextLimit;

  return (
    <div className="space-y-3 p-4 bg-gray-50 rounded-lg border">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Context Window Usage</h3>
        <span className="text-xs text-gray-500">{(contextLimit / 1000).toFixed(0)}K limit</span>
      </div>

      <div className="space-y-2">
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-600">Raw (no preprocessing)</span>
            <span className={rawOverflow ? 'text-red-600 font-medium' : 'text-gray-600'}>
              {(rawTokens / 1000).toFixed(1)}K tokens
              {rawOverflow && ' — OVERFLOW'}
            </span>
          </div>
          <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${rawOverflow ? 'bg-red-500' : 'bg-orange-400'}`}
              style={{ width: `${rawPercent}%` }}
            />
          </div>
        </div>

        {processedPercent !== null && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-gray-600">Preprocessed</span>
              <span className="text-green-600 font-medium">
                {(processedTokens! / 1000).toFixed(1)}K tokens
              </span>
            </div>
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${processedPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
