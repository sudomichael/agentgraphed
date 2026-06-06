'use client';

import { useState, useTransition } from 'react';
import { generateContextAction } from '@/app/sessions/[id]/actions';

type Props = {
  sessionId: string;
  provider: 'claude' | 'codex' | string;
  cwd: string;
  hasLlmKey: boolean;
  cachedContext: string | null;
};

function resumeCommand(provider: string, cwd: string, id: string): string {
  const cdPart = `cd "${cwd}"`;
  if (provider === 'claude') return `${cdPart} && claude --resume ${id}`;
  if (provider === 'codex') return `${cdPart} && codex resume ${id}`;
  return cdPart;
}

export function SessionActions({ sessionId, provider, cwd, hasLlmKey, cachedContext }: Props) {
  const [resumeCopied, setResumeCopied] = useState(false);
  const [context, setContext] = useState<string | null>(cachedContext);
  const [contextCopied, setContextCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const cmd = resumeCommand(provider, cwd, sessionId);

  const copyResume = async () => {
    await navigator.clipboard.writeText(cmd);
    setResumeCopied(true);
    setTimeout(() => setResumeCopied(false), 1800);
  };

  const onContext = () => {
    setError(null);
    startTransition(async () => {
      // If we already have it, just copy.
      if (context) {
        await navigator.clipboard.writeText(context);
        setContextCopied(true);
        setTimeout(() => setContextCopied(false), 1800);
        return;
      }
      const result = await generateContextAction(sessionId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setContext(result.context);
      setCost(result.costUsd);
      await navigator.clipboard.writeText(result.context);
      setContextCopied(true);
      setTimeout(() => setContextCopied(false), 1800);
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={copyResume}
          className="btn"
          title={cmd}
        >
          {resumeCopied ? '✓ Copied' : '⟲ Resume session'}
        </button>
        <button
          onClick={onContext}
          disabled={!hasLlmKey || pending}
          title={hasLlmKey ? 'Generate a short primer for a fresh chat' : 'Add an API key in Settings to enable'}
          className={`btn ${hasLlmKey ? 'btn-primary' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {pending ? '… generating' : contextCopied ? '✓ Copied' : context ? '⎘ Copy context' : '✶ Generate & copy context'}
        </button>
      </div>
      {error && <div className="text-body-sm text-error">{error}</div>}
      {cost !== null && cost > 0 && (
        <div className="text-[10px] font-mono text-ink-mute">cost: ${cost.toFixed(4)}</div>
      )}
      {!hasLlmKey && (
        <div className="text-[11px] text-ink-mute">
          “Copy context” needs an API key —{' '}
          <a href="/settings" className="text-primary hover:underline">add one in Settings</a>
        </div>
      )}
    </div>
  );
}
