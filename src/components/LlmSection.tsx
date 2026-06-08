'use client';

import { useState, useTransition } from 'react';
import { saveLlmAction, clearKeyAction, setAutoClassifyAction } from '@/app/settings/llm-actions';
import { classifyAction, estimateAction } from '@/app/settings/classify-actions';
import { modelsForProvider, defaultModel, type LlmProvider } from '@/lib/llm/models';

type Props = {
  provider: LlmProvider;
  anthKey: string;
  oaiKey: string;
  classifierModel: string;
  summarizerModel: string;
  classified: number;
  total: number;
  autoClassify: boolean;
};

const mask = (k: string) => (k ? k.slice(0, 8) + '…' + k.slice(-4) : '');

export function LlmSection({
  provider: initialProvider,
  anthKey,
  oaiKey,
  classifierModel: initialModel,
  summarizerModel,
  classified,
  total,
  autoClassify: initialAutoClassify,
}: Props) {
  const [provider, setProvider] = useState<LlmProvider>(initialProvider);
  const [model, setModel] = useState<string>(initialModel);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [autoClassify, setAutoClassify] = useState(initialAutoClassify);
  const [classifyState, setClassifyState] = useState<
    | { kind: 'idle' }
    | { kind: 'estimate'; totalUsd: number; rowCount: number; modelLabel: string; scope: 'uncategorized' | 'all' }
    | { kind: 'done'; classified: number; costUsd: number; warning?: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const providerKey = provider === 'openai' ? oaiKey : anthKey;
  const hasKey = providerKey.length > 0;
  const providerModels = modelsForProvider(provider);

  // If the current model doesn't belong to the active provider (e.g. user just
  // flipped providers), snap to that provider's default. This keeps the
  // dropdown's selected value valid against its options.
  const modelBelongsToProvider = providerModels.some((m) => m.id === model);
  const activeModel = modelBelongsToProvider ? model : defaultModel(provider);

  const onProviderChange = (next: LlmProvider) => {
    setProvider(next);
    if (!modelsForProvider(next).some((m) => m.id === model)) {
      setModel(defaultModel(next));
    }
  };

  const onSave = (formData: FormData) => {
    startTransition(async () => {
      await saveLlmAction(formData);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2000);
    });
  };

  const onEstimate = (scope: 'uncategorized' | 'all') => {
    setClassifyState({ kind: 'idle' });
    startTransition(async () => {
      const r = await estimateAction(scope);
      if (!r.ok) setClassifyState({ kind: 'error', message: r.error });
      else setClassifyState({ kind: 'estimate', totalUsd: r.totalUsd, rowCount: r.rowCount, modelLabel: r.modelLabel, scope });
    });
  };

  const onToggleAuto = (next: boolean) => {
    setAutoClassify(next);
    startTransition(async () => {
      await setAutoClassifyAction(next);
    });
  };

  const onRun = (scope: 'uncategorized' | 'all') => {
    startTransition(async () => {
      const r = await classifyAction(scope);
      if (!r.ok) setClassifyState({ kind: 'error', message: r.error });
      else setClassifyState({ kind: 'done', classified: r.classified, costUsd: r.costUsd, warning: r.warning });
    });
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>LLM provider</span>
        <span className="normal-case tracking-normal text-ink-mute text-[11px] font-mono">
          {classified}/{total} sessions classified
        </span>
      </div>
      <form action={onSave} className="p-5 space-y-4 text-body-md">
        <p className="text-ink-dim text-body-sm">
          Optional. Used to auto-title and categorize sessions, and to generate context primers when you
          click <em>Copy context</em> on a session. Skip this and titles stay as the raw first prompt.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-label-caps text-ink-mute block">Provider</label>
            <select
              name="provider"
              value={provider}
              onChange={(e) => onProviderChange(e.target.value as LlmProvider)}
              className="bg-surface-1 border border-surface-3 rounded px-2 h-9 text-body-md w-full"
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-label-caps text-ink-mute block">Model</label>
            <select
              name="classifier_model"
              value={activeModel}
              onChange={(e) => setModel(e.target.value)}
              className="bg-surface-1 border border-surface-3 rounded px-2 h-9 text-body-md font-mono w-full"
            >
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-label-caps text-ink-mute block flex items-center justify-between">
              Anthropic key
              {anthKey && (
                <button
                  type="button"
                  onClick={() => startTransition(() => clearKeyAction('anthropic'))}
                  className="normal-case tracking-normal text-[10px] text-ink-mute hover:text-error"
                >
                  clear
                </button>
              )}
            </label>
            <input
              type="password"
              name="anthropic_key"
              placeholder={mask(anthKey) || 'sk-ant-…'}
              className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono w-full focus:outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-label-caps text-ink-mute block flex items-center justify-between">
              OpenAI key
              {oaiKey && (
                <button
                  type="button"
                  onClick={() => startTransition(() => clearKeyAction('openai'))}
                  className="normal-case tracking-normal text-[10px] text-ink-mute hover:text-error"
                >
                  clear
                </button>
              )}
            </label>
            <input
              type="password"
              name="openai_key"
              placeholder={mask(oaiKey) || 'sk-…'}
              className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono w-full focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <p className="text-[11px] text-ink-mute leading-relaxed">
          Keys are stored in plaintext in your local SQLite file — same threat model as{' '}
          <span className="font-mono">~/.aws/credentials</span> or a <span className="font-mono">.env</span>.
          Never sent over the network. Any process that can read your home folder can read them.
        </p>

        <input type="hidden" name="summarizer_model" value={summarizerModel} />

        <div className="flex items-center gap-2">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {savedAt && <span className="text-body-sm text-secondary">✓ saved</span>}
        </div>
      </form>

      <div className="px-5 pb-5 border-t border-surface-2 pt-4 space-y-3">
        <label className={`flex items-start gap-3 text-body-sm ${hasKey ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            checked={autoClassify}
            onChange={(e) => onToggleAuto(e.target.checked)}
            disabled={!hasKey || pending}
            className="mt-1 accent-primary"
          />
          <span className="text-ink-dim">
            <span className="text-ink font-medium">Automatically classify new sessions</span>
            <span className="block text-ink-mute text-[11px] mt-0.5">
              When a background scan finds unclassified sessions, batch them through the classifier. Costs ~$0.0001 per session.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={!hasKey || pending}
            onClick={() => onEstimate('uncategorized')}
            className="btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Classify uncategorized
          </button>
          <button
            type="button"
            disabled={!hasKey || pending}
            onClick={() => onEstimate('all')}
            className="btn disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Re-classify all
          </button>
          {!hasKey && (
            <span className="text-body-sm text-ink-mute">Save a key above to enable.</span>
          )}
        </div>

        {classifyState.kind === 'estimate' && (
          <div className="border border-primary/40 bg-primary/5 rounded p-3 text-body-sm">
            <div className="text-ink mb-2">
              {classifyState.rowCount === 0
                ? 'Nothing to classify.'
                : (
                  <>
                    About to classify <span className="font-mono text-primary">{classifyState.rowCount}</span>{' '}
                    sessions with {classifyState.modelLabel} for an estimated{' '}
                    <span className="font-mono text-primary">${classifyState.totalUsd.toFixed(4)}</span>.
                  </>
                )}
            </div>
            {classifyState.rowCount > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRun(classifyState.scope)}
                  className="btn btn-primary"
                  disabled={pending}
                >
                  {pending ? 'Classifying…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setClassifyState({ kind: 'idle' })}
                  className="btn"
                  disabled={pending}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {classifyState.kind === 'done' && (
          <div className="border border-secondary/40 bg-secondary/5 rounded p-3 text-body-sm text-ink space-y-1">
            <div>
              ✓ Classified <span className="font-mono text-secondary">{classifyState.classified}</span>{' '}
              sessions for <span className="font-mono">${classifyState.costUsd.toFixed(4)}</span>.
            </div>
            {classifyState.warning && (
              <div className="text-error text-[11px] border-l-2 border-error pl-2 font-mono break-words">
                Warning: {classifyState.warning}
              </div>
            )}
          </div>
        )}

        {classifyState.kind === 'error' && (
          <div className="text-body-sm text-error border-l-2 border-error pl-3">{classifyState.message}</div>
        )}
      </div>
    </div>
  );
}
