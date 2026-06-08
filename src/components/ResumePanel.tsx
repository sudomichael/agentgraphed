'use client';

import { useState } from 'react';

// "Resume in your terminal" panel. Modeled after the GitHub clone-URL box:
// the literal command is always visible in a mono chip, with a Copy button on
// the right. No mystery about what gets copied — it's the thing the user is
// looking at.

type Props = {
  provider: 'claude' | 'codex' | string;
  cwd: string;
  sessionId: string;
};

function resumeCommand(provider: string, cwd: string, id: string): string {
  const cdPart = `cd "${cwd}"`;
  if (provider === 'claude') return `${cdPart} && claude --resume ${id}`;
  if (provider === 'codex') return `${cdPart} && codex resume ${id}`;
  return cdPart;
}

function providerName(provider: string): string {
  if (provider === 'claude') return 'Claude Code';
  if (provider === 'codex') return 'Codex CLI';
  return provider;
}

export function ResumePanel({ provider, cwd, sessionId }: Props) {
  const [copied, setCopied] = useState(false);
  const cmd = resumeCommand(provider, cwd, sessionId);

  const copy = async () => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Resume in your terminal</span>
        <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
          paste into {providerName(provider)}
        </span>
      </div>
      <div className="p-3 flex items-stretch gap-2">
        <code
          className="flex-1 bg-canvas border border-surface-3 rounded px-3 py-2 font-mono text-code-sm text-ink-dim overflow-x-auto whitespace-nowrap leading-relaxed"
          title={cmd}
        >
          {cmd}
        </code>
        <button
          onClick={copy}
          className={`btn ${copied ? 'text-secondary' : ''} flex-shrink-0`}
          title="Copy command to clipboard"
        >
          {copied ? (
            <>
              <CheckIcon />
              <span>Copied</span>
            </>
          ) : (
            <>
              <CopyIcon />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
