'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { classifyAction } from '@/app/settings/classify-actions';

// Inline dashboard chip that surfaces unclassified sessions when auto-classify
// is off and a key is configured. Click → confirm cost → classify → refresh.

type Props = {
  count: number;
  estimatedUsd: number;
};

export function ClassifyChip({ count, estimatedUsd }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<'idle' | 'confirm' | 'done' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ classified: number; costUsd: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (stage === 'idle') {
      setStage('confirm');
      return;
    }
    if (stage === 'confirm') {
      startTransition(async () => {
        const r = await classifyAction('uncategorized');
        if (!r.ok) {
          setErrMsg(r.error);
          setStage('err');
          setTimeout(() => setStage('idle'), 4000);
          return;
        }
        setResult({ classified: r.classified, costUsd: r.costUsd });
        setStage('done');
        router.refresh();
        setTimeout(() => setStage('idle'), 3000);
      });
    }
  };

  if (stage === 'done' && result) {
    return (
      <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-secondary/10 text-secondary border border-secondary/30">
        ✓ classified {result.classified} · ${result.costUsd.toFixed(4)}
      </div>
    );
  }

  if (stage === 'err') {
    return (
      <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-error/10 text-error border border-error/30" title={errMsg ?? ''}>
        ✗ failed
      </div>
    );
  }

  if (stage === 'confirm') {
    return (
      <button
        onClick={onClick}
        disabled={pending}
        className="text-[11px] font-mono px-2 py-0.5 rounded bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 transition-colors disabled:opacity-60"
        title="Click again to confirm — sends prompts to your configured provider"
      >
        {pending ? '… classifying' : `confirm · run for ~$${estimatedUsd.toFixed(4)}`}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="text-[11px] font-mono px-2 py-0.5 rounded text-ink-mute hover:text-primary hover:bg-surface-2 transition-colors"
      title="Send their first prompts to your configured LLM to assign a title + category. ~$0.0001 per session."
    >
      {count} unclassified · classify
    </button>
  );
}
