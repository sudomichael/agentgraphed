'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLeaderboardOptInAction } from '@/app/leaderboard/actions';

// Single client component for both opt-in (with handle entry) and opt-out.
// Handles three states:
//   - not opted in: handle input + "Opt in & submit" button
//   - opted in:     greyed-out handle, "Change handle" link, "Opt out" button
//   - busy:         spinner state while the server action runs
//
// On opt-in the server action persists both settings (opt_in='on' +
// handle), then triggers an immediate submission to the public endpoint
// so the user sees "last submission" populate without waiting a week.

type Props = {
  initialOptIn: boolean;
  initialHandle: string;
};

function defaultHandle(): string {
  // Suggest a friendly default the user can keep or replace. Three syllables
  // tend to look right; avoid common slurs by drawing from a safe word list.
  const adj = ['turbo', 'neon', 'caffeinated', 'midnight', 'orbital', 'vector', 'quantum', 'ambient'];
  const noun = ['dev', 'coder', 'pilot', 'wrangler', 'sprinter', 'engineer', 'shipper', 'hacker'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  return `${a}-${n}`;
}

export function LeaderboardOptIn({ initialOptIn, initialHandle }: Props) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [handle, setHandle] = useState(initialHandle || defaultHandle());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onSubmit = (next: boolean) => {
    setError(null);
    const trimmed = handle.trim();
    if (next && !/^[a-z0-9][a-z0-9_-]{1,23}$/i.test(trimmed)) {
      setError('Handle must be 2–24 chars: letters, numbers, dash or underscore.');
      return;
    }
    startTransition(async () => {
      const result = await setLeaderboardOptInAction({ optIn: next, handle: trimmed });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOptIn(next);
      router.refresh();
    });
  };

  if (optIn) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={pending}
          className="btn"
        >
          {pending ? 'Opting out…' : 'Opt out'}
        </button>
        <span className="text-[11px] text-ink-mute">
          Your handle stays saved locally so you can opt back in any time.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-stretch gap-2 flex-wrap">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="your-handle"
          aria-label="Handle"
          className="bg-surface-1 border border-surface-3 rounded px-4 h-11 text-body-md font-mono flex-1 min-w-[240px] focus:outline-none focus:border-secondary"
          maxLength={24}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          onClick={() => onSubmit(true)}
          disabled={pending}
          className="btn btn-primary !h-11 !px-6 text-body-md font-semibold"
        >
          {pending ? 'Joining…' : 'Join leaderboard →'}
        </button>
      </div>
      {error && (
        <div className="text-body-sm text-error">{error}</div>
      )}
      <div className="text-[11px] text-ink-mute leading-relaxed">
        Defaults to a friendly random handle — change it to whatever you want. Anonymous; no email
        or account needed. You can opt out (and delete your data) any time.
      </div>
    </div>
  );
}
