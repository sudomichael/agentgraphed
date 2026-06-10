'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setLeaderboardOptInAction } from '@/app/leaderboard/actions';
import { detectSocial, SOCIAL_LIMITS } from '@/lib/social';

// Single client component for both opt-in (with handle entry) and the
// opted-in management surface.
//
// Three sub-states:
//   - not opted in: handle input + 3 optional social URL inputs + "Join" button
//   - opted in:    3 editable social URL inputs + "Save links" + "Opt out"
//   - busy:        spinner state while the server action runs
//
// On opt-in the server action persists settings (opt_in='on' + handle +
// social_links) and triggers an immediate submission so the user sees
// "last submission" populate without waiting. "Save links" calls the
// same action with optIn=true (idempotent) — that pushes the new
// social_links along with the next session payload.

type Props = {
  initialOptIn: boolean;
  initialHandle: string;
  initialSocialLinks: string[];
};

function defaultHandle(): string {
  const adj = ['turbo', 'neon', 'caffeinated', 'midnight', 'orbital', 'vector', 'quantum', 'ambient'];
  const noun = ['dev', 'coder', 'pilot', 'wrangler', 'sprinter', 'engineer', 'shipper', 'hacker'];
  const a = adj[Math.floor(Math.random() * adj.length)];
  const n = noun[Math.floor(Math.random() * noun.length)];
  return `${a}-${n}`;
}

// Pad the saved list out to maxLinks slots so the user always sees three
// inputs with existing values pre-filled in the first N.
function padSlots(saved: string[]): string[] {
  const out = saved.slice(0, SOCIAL_LIMITS.maxLinks);
  while (out.length < SOCIAL_LIMITS.maxLinks) out.push('');
  return out;
}

export function LeaderboardOptIn({ initialOptIn, initialHandle, initialSocialLinks }: Props) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [handle, setHandle] = useState(initialHandle || defaultHandle());
  const [socialSlots, setSocialSlots] = useState<string[]>(padSlots(initialSocialLinks));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const setSlot = (idx: number, value: string) => {
    setSocialSlots((cur) => cur.map((v, i) => (i === idx ? value : v)));
    setSaved(false);
  };

  const onSubmit = (next: boolean) => {
    setError(null);
    setSaved(false);
    const trimmedHandle = handle.trim();
    if (next && !/^[a-z0-9][a-z0-9_-]{1,23}$/i.test(trimmedHandle)) {
      setError('Handle must be 2–24 chars: letters, numbers, dash or underscore.');
      return;
    }
    // Quick client-side rejection of obviously malformed URLs so the user
    // sees feedback before hitting the wire. detectSocial returns null
    // for anything that can't be parsed as https.
    const trimmedSlots = socialSlots.map((s) => s.trim());
    for (const url of trimmedSlots) {
      if (url && !detectSocial(url)) {
        setError(`Couldn't parse "${url}" as a URL. Use a full link like https://github.com/<you>.`);
        return;
      }
    }
    startTransition(async () => {
      const result = await setLeaderboardOptInAction({
        optIn: next,
        handle: trimmedHandle,
        socialLinks: trimmedSlots.filter(Boolean),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOptIn(next);
      setSaved(next);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {!optIn && (
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
      )}

      <div className="space-y-2">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">
          Social links {optIn ? '' : '(optional)'}
        </div>
        <div className="space-y-1.5">
          {socialSlots.map((url, idx) => (
            <input
              key={idx}
              type="url"
              value={url}
              onChange={(e) => setSlot(idx, e.target.value)}
              placeholder={
                idx === 0 ? 'https://github.com/<you>' :
                idx === 1 ? 'https://x.com/<you>' :
                'https://reddit.com/user/<you>'
              }
              aria-label={`Social link ${idx + 1}`}
              className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-sm font-mono w-full focus:outline-none focus:border-secondary"
              maxLength={SOCIAL_LIMITS.maxUrlLength}
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          ))}
        </div>
        <div className="text-[11px] text-ink-mute leading-relaxed">
          Up to 3 links shown next to your handle on the leaderboard. Self-asserted &mdash;
          we don&rsquo;t verify them. GitHub, X, Reddit, Bluesky, Mastodon, LinkedIn, YouTube,
          or any other URL.
        </div>
      </div>

      {optIn && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => onSubmit(true)}
            disabled={pending}
            className="btn btn-primary"
          >
            {pending ? 'Saving…' : saved ? '✓ Saved' : 'Save links'}
          </button>
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
      )}

      {!optIn && (
        <div className="text-[11px] text-ink-mute leading-relaxed">
          Defaults to a friendly random handle — change it to whatever you want. Anonymous; no email
          or account needed. You can opt out (and delete your data) any time.
        </div>
      )}

      {error && (
        <div className="text-body-sm text-error">{error}</div>
      )}
    </div>
  );
}
