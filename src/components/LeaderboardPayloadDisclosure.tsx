'use client';

import { useState } from 'react';

// Two-level disclosure for the privacy story:
//   Level 1 (top-level <details>): the short "what we don't collect" summary.
//     Collapsed by default; users who want to skip privacy don't have to scroll.
//   Level 2 (nested <details>): the literal JSON payload.
//     Collapsed even within the open privacy section, because the JSON block
//     is large and only the most privacy-conscious users actually want to
//     read it.
//
// Implementation note: <details>/<summary> handle their own open state, but
// we use client-component state for the JSON inner toggle so we can attach
// a "copied" affordance later without rebuilding the tree.

type Props = {
  previewJson: string;
  // Optional context: how many sessions are queued up. Negative = "we don't
  // know / don't show", 0 = "no usage yet — payload is empty".
  sessionCount: number;
};

export function LeaderboardPayloadDisclosure({ previewJson }: Props) {
  const [jsonOpen, setJsonOpen] = useState(false);
  return (
    <details className="card">
      <summary className="card-header cursor-pointer flex items-center justify-between list-none">
        <span>Privacy · what gets sent</span>
        <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
          click to expand
        </span>
      </summary>
      <div className="p-5 space-y-4 text-body-sm text-ink-dim leading-relaxed">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-2">
            What we don&apos;t collect
          </div>
          <ul className="space-y-1 pl-1">
            <Bullet>Your prompts or any message content (yours or Claude&apos;s).</Bullet>
            <Bullet>Project names, repository names, or directory names.</Bullet>
            <Bullet>File paths, file contents, or anything from your cwd.</Bullet>
            <Bullet>Git branches, remotes, or commit hashes.</Bullet>
            <Bullet>Session transcripts, system prompts, tool inputs, or tool outputs.</Bullet>
            <Bullet>Your email, real name, or any account identifier.</Bullet>
            <Bullet>API keys.</Bullet>
            <Bullet>Your raw IP address (it&apos;s hashed with a server secret before storage).</Bullet>
          </ul>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-wider text-ink-mute mb-2">
            What we do collect
          </div>
          <p className="text-body-sm">
            One JSON object per submission with the handle you chose plus per-session
            aggregates — start time, duration, provider, model, token counts (by kind), est.
            cost, message count. Submission cadence: every 6 hours, or sooner if a new session
            finished since the last submit.
          </p>
        </div>

        <details
          open={jsonOpen}
          onToggle={(e) => setJsonOpen((e.target as HTMLDetailsElement).open)}
          className="border border-surface-3 rounded"
        >
          <summary className="cursor-pointer list-none px-3 py-2 flex items-center justify-between text-body-sm text-ink-dim hover:bg-surface-1 rounded">
            <span>Show exact payload (JSON)</span>
            <span className="text-[11px] text-ink-mute">
              {jsonOpen ? '▴ hide' : '▾ show'}
            </span>
          </summary>
          <pre className="bg-canvas border-t border-surface-3 p-3 text-code-sm font-mono text-ink-dim overflow-x-auto max-h-96">
{previewJson}
          </pre>
        </details>

        <div className="text-[11px] text-ink-mute leading-relaxed">
          <a
            href="https://agentgraphed.com/privacy"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Read the full privacy policy →
          </a>{' '}
          (covers retention, your audit/delete endpoints, and links to the open-source backend
          code on GitHub).
        </div>
      </div>
    </details>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="text-ink-mute flex-shrink-0">·</span>
      <span>{children}</span>
    </li>
  );
}
