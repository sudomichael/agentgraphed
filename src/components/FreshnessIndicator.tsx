'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

// "updated Xs ago" / "↻ refresh" pill. The slot is a FIXED pixel width so
// neither the hover-state swap nor the ticking time can ever cause horizontal
// shift on the header row. Time values are zero-padded to 2 digits so
// "5s"→"15s"→"45s" all occupy the same character count too.

export function FreshnessIndicator({ lastIngestedAt }: { lastIngestedAt: number }) {
  const [, setTick] = useState(0);
  const [hover, setHover] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  function refresh() {
    startTransition(() => router.refresh());
  }

  const label = lastIngestedAt === 0 ? 'never scanned' : `updated ${fmtAgo(lastIngestedAt)} ago`;
  const disabled = lastIngestedAt === 0;
  const showRefresh = hover || isPending;

  return (
    <button
      type="button"
      onClick={refresh}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      disabled={disabled || isPending}
      title="Re-scan local sessions and refresh"
      // SLOT WIDTH IS FIXED. Do not change to inline-flex or remove width.
      // Empirically tuned to fit "updated 99m ago" and "↻ refresh" both;
      // longer states ("never scanned") still fit because they only appear
      // pre-first-scan.
      style={{ width: '128px' }}
      className="text-[11px] font-mono tabular px-2 py-0.5 rounded transition-colors text-ink-mute hover:text-primary hover:bg-surface-2 focus-visible:text-primary focus-visible:bg-surface-2 outline-none disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-mute disabled:cursor-not-allowed grid items-center"
    >
      <span
        className="col-start-1 row-start-1 transition-opacity flex items-center justify-center gap-1.5 whitespace-nowrap"
        style={{ opacity: showRefresh ? 0 : 1 }}
      >
        {label}
      </span>
      <span
        aria-hidden
        className="col-start-1 row-start-1 transition-opacity flex items-center justify-center gap-1.5 whitespace-nowrap"
        style={{ opacity: showRefresh ? 1 : 0 }}
      >
        <RefreshIcon spinning={isPending} />
        <span>refresh</span>
      </span>
    </button>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? 'animate-spin' : ''}
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

// Zero-pad to 2 chars for stable width: 04s, 12s, 03m, 22h. The "just now"
// branch is intentionally not padded — it's already wider than any padded
// value and only briefly appears in the first second post-scan.
function fmtAgo(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${pad(Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${pad(Math.round(ms / 60_000))}m`;
  return `${pad(Math.round(ms / 3_600_000))}h`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
