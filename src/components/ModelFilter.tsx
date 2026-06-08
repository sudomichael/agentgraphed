'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type Family = { family: string; sessions: number };

export function ModelFilter({
  families,
  current,
}: {
  families: Family[];
  current: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setMounted(true), []);

  const select = (family: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (family) params.set('model', family);
    else params.delete('model');
    const qs = params.toString();
    setOpen(false);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const pop = document.getElementById('model-filter-pop');
      if (pop?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 200) });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        className={`text-[11px] font-mono px-2 py-0.5 rounded transition-colors flex items-center gap-1.5 ${
          current
            ? 'bg-primary/15 text-primary'
            : 'text-ink-mute hover:text-ink-dim hover:bg-surface-2'
        } ${pending ? 'opacity-60' : ''}`}
        title="Filter by model"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className="truncate max-w-[140px]">{current ?? 'All models'}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {mounted && open && anchor && createPortal(
        <div
          id="model-filter-pop"
          style={{
            position: 'fixed',
            top: anchor.top,
            left: anchor.left,
            minWidth: anchor.width,
            backgroundColor: '#1c2026',
            zIndex: 100,
            isolation: 'isolate',
          }}
          className="border border-surface-3 rounded-md shadow-xl overflow-hidden text-[12px] font-mono max-h-[60vh] overflow-y-auto"
        >
          <button
            onClick={() => select(null)}
            className={`w-full text-left px-3 py-2 transition-colors hover:bg-surface-2 ${
              !current ? 'text-primary bg-primary/10' : 'text-ink-dim'
            }`}
          >
            All models
          </button>
          <div className="h-px bg-surface-3" />
          {families.map((f) => (
            <button
              key={f.family}
              onClick={() => select(f.family)}
              className={`w-full text-left px-3 py-2 transition-colors hover:bg-surface-2 flex items-center justify-between gap-3 ${
                current === f.family ? 'text-primary bg-primary/10' : 'text-ink-dim'
              }`}
              title={f.family}
            >
              <span className="truncate">{f.family}</span>
              <span className="text-ink-mute text-[10px] tabular">{f.sessions}</span>
            </button>
          ))}
          {families.length === 0 && (
            <div className="px-3 py-2 text-ink-mute">No models seen yet.</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
