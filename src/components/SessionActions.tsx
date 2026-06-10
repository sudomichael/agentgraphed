'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { classifySessionAction, generateContextAction } from '@/app/sessions/[id]/actions';

type Props = {
  sessionId: string;
  hasLlmKey: boolean;
  cachedContext: string | null;
  // True when the current title is just the (heuristic) first prompt — show
  // a "Title this session" button so the user doesn't have to wait for the
  // background classifier to come around.
  needsClassification: boolean;
};

export function SessionActions({ sessionId, hasLlmKey, cachedContext, needsClassification }: Props) {
  const router = useRouter();
  const [context, setContext] = useState<string | null>(cachedContext);
  const [contextCopied, setContextCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [classifyPending, startClassify] = useTransition();
  const [classifyError, setClassifyError] = useState<string | null>(null);

  const onClassify = () => {
    setClassifyError(null);
    startClassify(async () => {
      const result = await classifySessionAction(sessionId);
      if (!result.ok) {
        setClassifyError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const onContext = () => {
    setError(null);
    startTransition(async () => {
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
    <div className="flex items-center gap-2 relative">
      {needsClassification && (
        <button
          onClick={onClassify}
          disabled={!hasLlmKey || classifyPending}
          title={hasLlmKey ? 'Run the classifier on just this session, right now' : 'Add an API key in Settings to enable'}
          className="btn disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {classifyPending ? '… titling' : 'Title this session'}
        </button>
      )}
      <button
        onClick={onContext}
        disabled={!hasLlmKey || pending}
        title={hasLlmKey ? 'Summarize this session so you can paste it into a fresh chat' : 'Add an API key in Settings to enable'}
        className={`btn ${hasLlmKey ? 'btn-primary' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {pending ? '… summarizing' : contextCopied ? '✓ Copied' : context ? 'Copy summary' : 'Summarize for new chat'}
      </button>
      {(error || classifyError || (cost !== null && cost > 0) || !hasLlmKey) && (
        <div className="absolute top-full right-0 mt-2 text-[11px] text-ink-mute flex items-center gap-2 whitespace-nowrap">
          {classifyError && <span className="text-error">{classifyError}</span>}
          {error && <span className="text-error">{error}</span>}
          {cost !== null && cost > 0 && <span className="font-mono">cost ${cost.toFixed(4)}</span>}
          {!hasLlmKey && (
            <span>
              needs <Link href="/settings" className="text-primary hover:underline">an API key</Link>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
