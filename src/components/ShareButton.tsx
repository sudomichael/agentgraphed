'use client';

import { useState } from 'react';

// Icon-only share button — modeled after iOS / Twitter / GitHub / Linear, all
// of which use a share glyph rather than the words "Share stats." Single job:
// fetch the share-image PNG and copy it to the OS clipboard. On older browsers
// without ClipboardItem image support we fall back to a download so the user
// is never stuck. The icon swaps to a checkmark briefly on success.

type Props = {
  imageUrl: string;
  className?: string;
};

type Status = 'idle' | 'busy' | 'done' | 'err';

export function ShareButton({ imageUrl, className }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onClick = async () => {
    setStatus('busy');
    setErrMsg(null);
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('clipboard image unsupported');
      }
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      setStatus('done');
      setTimeout(() => setStatus('idle'), 2400);
    } catch (e) {
      try {
        const resp = await fetch(imageUrl);
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = 'agentgraphed-stats.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
        setErrMsg('Saved to Downloads (clipboard image unsupported)');
        setStatus('err');
        setTimeout(() => setStatus('idle'), 4_000);
      } catch (e2) {
        setErrMsg((e2 as Error).message || (e as Error).message);
        setStatus('err');
        setTimeout(() => setStatus('idle'), 3_000);
      }
    }
  };

  const title =
    status === 'busy' ? 'Generating image…' :
    status === 'done' ? 'Image copied to clipboard' :
    status === 'err' ? (errMsg ?? 'Try again') :
    'Copy share image to clipboard';

  return (
    <button
      onClick={onClick}
      disabled={status === 'busy'}
      aria-label="Share"
      title={title}
      className={`btn-icon ${status === 'done' ? 'text-secondary' : ''} ${className ?? ''}`}
    >
      {status === 'busy' ? <Spinner /> : status === 'done' ? <CheckIcon /> : <ShareIcon />}
    </button>
  );
}

function ShareIcon() {
  // Classic share glyph: arrow up out of tray. Recognizable across iOS/macOS.
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
