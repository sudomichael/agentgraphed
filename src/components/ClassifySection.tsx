'use client';

import { useState, useTransition } from 'react';
import { classifyAction, estimateAction } from '@/app/settings/classify-actions';

type Props = {
  hasKey: boolean;
  classifierModelId: string;
  classified: number;
  total: number;
};

export function ClassifySection({ hasKey, classifierModelId, classified, total }: Props) {
  const [pending, startTransition] = useTransition();
  const [estimate, setEstimate] = useState<{ totalUsd: number; perSessionUsd: number; modelLabel: string; rowCount: number; scope: 'uncategorized' | 'all' } | null>(null);
  const [result, setResult] = useState<{ classified: number; costUsd: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'uncategorized' | 'all'>('uncategorized');

  const onEstimate = (s: 'uncategorized' | 'all') => {
    setError(null);
    setResult(null);
    setScope(s);
    startTransition(async () => {
      const r = await estimateAction(s);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEstimate({ ...r, scope: s });
    });
  };

  const onRun = () => {
    if (!estimate) return;
    setError(null);
    startTransition(async () => {
      const r = await classifyAction(estimate.scope);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResult({ classified: r.classified, costUsd: r.costUsd });
      setEstimate(null);
    });
  };

  return (
    <div className="card">
      <div className="card-header">Classify sessions</div>
      <div className="p-5 space-y-4 text-body-md text-ink-dim">
        <p>
          Use the LLM to give every session a clean title (e.g. <em className="text-ink">“Fixed Stripe checkout double-decimal bug”</em>)
          and a category. Cheap models like Haiku and GPT-5 Mini cost fractions of a cent per session because we batch them.
        </p>

        <div className="font-mono text-code-sm text-ink-mute">
          {classified}/{total} sessions classified · model: {classifierModelId}
        </div>

        {!hasKey && (
          <div className="text-body-sm text-ink-mute border-l-2 border-outline pl-3">
            Add an API key above to enable classification. Until then, sessions display the first line of the prompt.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!hasKey || pending}
            onClick={() => onEstimate('uncategorized')}
            className="btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Estimate · uncategorized only
          </button>
          <button
            type="button"
            disabled={!hasKey || pending}
            onClick={() => onEstimate('all')}
            className="btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Estimate · re-classify all
          </button>
        </div>

        {estimate && (
          <div className="border border-primary/40 bg-primary/5 rounded p-4 space-y-2">
            <div className="text-body-md text-ink">
              Estimated cost: <span className="font-mono text-primary">${estimate.totalUsd.toFixed(4)}</span>{' '}
              <span className="text-ink-mute">
                ({estimate.rowCount} sessions × ~${estimate.perSessionUsd.toFixed(5)} each · {estimate.modelLabel})
              </span>
            </div>
            <div className="text-body-sm text-ink-mute">
              This is a rough estimate based on average prompt length. Actual cost may be ±50%.
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={onRun} disabled={pending} className="btn btn-primary disabled:opacity-50">
                {pending ? 'Classifying…' : `Confirm — run on ${estimate.rowCount} sessions`}
              </button>
              <button onClick={() => setEstimate(null)} className="btn" disabled={pending}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="border border-secondary/40 bg-secondary/5 rounded p-4">
            <div className="text-body-md text-ink">
              ✓ Classified <span className="font-mono text-secondary">{result.classified}</span> sessions ·
              actual cost <span className="font-mono">${result.costUsd.toFixed(4)}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="text-body-sm text-error border-l-2 border-error pl-3">{error}</div>
        )}
      </div>
    </div>
  );
}
