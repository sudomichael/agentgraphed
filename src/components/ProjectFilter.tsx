'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useState, useTransition, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type Project = { id: string; name: string };

export function ProjectFilter({
  projects,
  current,
}: {
  projects: Project[];
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

  const select = (id: string | null) => {
    const params = new URLSearchParams(sp.toString());
    if (id) params.set('project', id);
    else params.delete('project');
    const qs = params.toString();
    setOpen(false);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const currentName = current ? projects.find((p) => p.id === current)?.name ?? 'project' : null;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      const pop = document.getElementById('project-filter-pop');
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
      setAnchor({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 220) });
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
        title="Filter by project"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="truncate max-w-[140px]">{currentName ?? 'All projects'}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {mounted && open && anchor && createPortal(
        <div
          id="project-filter-pop"
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
            All projects
          </button>
          <div className="h-px bg-surface-3" />
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => select(p.id)}
              className={`w-full text-left px-3 py-2 transition-colors hover:bg-surface-2 truncate ${
                current === p.id ? 'text-primary bg-primary/10' : 'text-ink-dim'
              }`}
              title={p.name}
            >
              {p.name}
            </button>
          ))}
          {projects.length === 0 && (
            <div className="px-3 py-2 text-ink-mute">No projects yet.</div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
