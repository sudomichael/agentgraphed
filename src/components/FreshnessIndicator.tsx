'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// Tiny "updated 4s ago · refresh" badge for pages that auto-ingest in the
// background. The Next.js router.refresh() call re-runs the server component
// (and re-triggers the scan); useTransition gives us a pending state so we
// can dim while it's working.
//
// Pass the server-side timestamp of the last completed ingest. If 0, we say
// "never" and disable the refresh button until the first scan settles.

export function FreshnessIndicator({ lastIngestedAt }: { lastIngestedAt: number }) {
  const [, setTick] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  // Re-render every 5s so the "Xs ago" text stays current without polling
  // the server.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const label = lastIngestedAt === 0 ? 'never scanned' : `updated ${fmtAgo(lastIngestedAt)} ago`;

  return (
    <span className="text-[11px] text-ink-mute font-mono tabular flex items-center gap-2">
      <span>{label}</span>
      <button
        onClick={refresh}
        disabled={isPending}
        className="text-ink-mute hover:text-primary uppercase tracking-wide disabled:opacity-50"
        title="Re-scan local sessions and refresh"
      >
        {isPending ? '…' : 'refresh'}
      </button>
    </span>
  );
}

function fmtAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}
