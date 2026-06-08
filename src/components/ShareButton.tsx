'use client';

import { useState } from 'react';

// Share-stats button. Two paths:
//
// PRIMARY (Chrome/Edge/Safari + mobile): use the Web Share API with the file
// attached so the OS share sheet pops up and the user can pick Twitter /
// Messages / LinkedIn / etc. with the image already attached. This is the
// only way to attach a file when "sharing to Twitter" from a browser —
// Twitter's intent URL does not accept image params.
//
// FALLBACK (Firefox, browsers without canShare on files): download the image
// + copy the suggested text to clipboard, then show clear instructions for
// the user to paste/drag manually. Honest UX, no false promise.

type Props = {
  imageUrl: string;            // /api/share/...
  filename: string;
  shareText: string;
  shareTitle?: string;
  className?: string;
  label?: string;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'shared' }                 // Web Share returned ok
  | { kind: 'fallback'; downloaded: boolean; copied: boolean }
  | { kind: 'err'; message: string };

export function ShareButton({
  imageUrl,
  filename,
  shareText,
  shareTitle = 'My AgentGraphed stats',
  className,
  label,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const onClick = async () => {
    setStatus({ kind: 'busy' });
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const file = new File([blob], filename, { type: 'image/png' });

      // Try the native share sheet first. Must check canShare with the file
      // because some browsers expose navigator.share but not file sharing.
      const canShareFile =
        typeof navigator !== 'undefined' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] });

      if (canShareFile) {
        try {
          await navigator.share({
            files: [file],
            text: shareText,
            title: shareTitle,
          });
          setStatus({ kind: 'shared' });
          setTimeout(() => setStatus({ kind: 'idle' }), 2400);
          return;
        } catch (err) {
          // User cancelled — silently return to idle; not an error.
          if ((err as Error).name === 'AbortError') {
            setStatus({ kind: 'idle' });
            return;
          }
          // Otherwise fall through to download-fallback.
        }
      }

      // Fallback: download the file, copy text to clipboard.
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);

      let copied = false;
      try {
        await navigator.clipboard.writeText(shareText);
        copied = true;
      } catch { /* clipboard write can fail in some contexts */ }

      setStatus({ kind: 'fallback', downloaded: true, copied });
      setTimeout(() => setStatus({ kind: 'idle' }), 6_000);
    } catch (e) {
      setStatus({ kind: 'err', message: (e as Error).message });
      setTimeout(() => setStatus({ kind: 'idle' }), 3_000);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={onClick}
        disabled={status.kind === 'busy'}
        className={`btn disabled:opacity-50 ${className ?? ''}`}
        title="Generate a share image for these stats"
      >
        {renderLabel(status, label)}
      </button>

      {status.kind === 'fallback' && (
        <div className="text-[11px] text-ink-mute font-mono leading-snug max-w-[260px] text-right">
          Image saved to Downloads.
          {status.copied && <> Text copied. </>}
          Drag the image into your post.
        </div>
      )}
      {status.kind === 'err' && (
        <div className="text-[11px] text-error font-mono">{status.message}</div>
      )}
    </div>
  );
}

function renderLabel(status: Status, customIdle?: string): string {
  switch (status.kind) {
    case 'busy':     return '… preparing';
    case 'shared':   return '✓ Shared';
    case 'fallback': return '✓ Saved · drag into your post';
    case 'err':      return 'Try again';
    default:         return customIdle ?? '⤴ Share stats';
  }
}
