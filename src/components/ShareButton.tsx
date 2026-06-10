'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Icon-only share button — modeled after iOS / Twitter / GitHub / Linear, all
// of which use a share glyph rather than the words "Share stats." Single job:
// fetch the share-image PNG and copy it to the OS clipboard. On older browsers
// without ClipboardItem image support we fall back to a download so the user
// is never stuck. On success we both swap the icon to a checkmark AND show a
// short-lived toast — without the toast the icon flicker is too subtle for
// most people to notice the image was copied.

type Props = {
  imageUrl: string;
  className?: string;
};

type Status = 'idle' | 'busy' | 'done' | 'err';
type Toast = { kind: 'success' | 'error'; message: string } | null;

export function ShareButton({ imageUrl, className }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const showToast = (t: NonNullable<Toast>, ttlMs: number) => {
    setToast(t);
    window.setTimeout(() => {
      // Only clear if it's still the same toast — avoids a fast double-click
      // clearing the second toast prematurely.
      setToast((cur) => (cur === t ? null : cur));
    }, ttlMs);
  };

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
      showToast({ kind: 'success', message: 'Image copied to clipboard' }, 2400);
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
        showToast({ kind: 'success', message: 'Saved to Downloads' }, 2400);
        setTimeout(() => setStatus('idle'), 2400);
      } catch (e2) {
        const msg = (e2 as Error).message || (e as Error).message;
        setErrMsg(msg);
        setStatus('err');
        showToast({ kind: 'error', message: `Share failed: ${msg}` }, 2400);
        setTimeout(() => setStatus('idle'), 2400);
      }
    }
  };

  const title =
    status === 'busy' ? 'Generating image…' :
    status === 'done' ? 'Image copied to clipboard' :
    status === 'err' ? (errMsg ?? 'Try again') :
    'Copy share image to clipboard';

  return (
    <>
      <button
        onClick={onClick}
        disabled={status === 'busy'}
        aria-label="Share"
        title={title}
        className={`btn-icon ${status === 'done' ? 'text-secondary' : ''} ${className ?? ''}`}
      >
        {status === 'busy' ? <Spinner /> : status === 'done' ? <CheckIcon /> : <ShareIcon />}
      </button>
      <ShareToast toast={toast} />
    </>
  );
}

function ShareToast({ toast }: { toast: Toast }) {
  // Only mount on the client (createPortal needs document) and only render
  // when there's something to show — keeps the DOM clean and avoids SSR
  // hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted || !toast) return null;
  const isError = toast.kind === 'error';
  const node = (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 pointer-events-none animate-toast-in"
    >
      <div
        className={[
          'flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-body-sm',
          isError
            ? 'bg-error/10 border-error/40 text-error'
            : 'bg-surface-2 border-surface-3 text-ink',
        ].join(' ')}
      >
        <span className={isError ? 'text-error' : 'text-secondary'}>
          {isError ? <ErrorIcon /> : <CheckIcon />}
        </span>
        <span>{toast.message}</span>
      </div>
    </div>
  );
  return createPortal(node, document.body);
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

function ErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16.5" x2="12" y2="16.5" />
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
