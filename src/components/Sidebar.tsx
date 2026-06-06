'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

const items = [
  { href: '/', label: 'Dashboard', icon: '◧' },
  { href: '/timeline', label: 'Timeline', icon: '☰' },
  { href: '/projects', label: 'Projects', icon: '▦' },
  { href: '/sessions', label: 'Sessions', icon: '⌘' },
  { href: '/analytics', label: 'Analytics', icon: '⌁' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r border-surface-2 bg-surface-0 flex flex-col sticky top-0 h-screen self-start">
      <div className="px-5 border-b border-surface-2 h-[72px] flex flex-col justify-center">
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className="text-primary text-base">◧</span>
          <span className="text-lg font-bold tracking-tight">
            <span className="text-ink-dim">Agent</span>
            <span className="text-primary">Graphed</span>
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-ink-mute mt-1.5">
          See your AI work
        </div>
      </div>
      <nav className="px-2 py-3 flex-1 flex flex-col gap-0.5">
        {items.map((it) => {
          const active = it.href === '/' ? pathname === '/' : pathname.startsWith(it.href);
          return (
            <Link
              key={it.href}
              href={it.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded text-[13px] transition-colors',
                active
                  ? 'bg-surface-2 text-primary border-l-2 border-primary -ml-px'
                  : 'text-ink-dim hover:text-ink hover:bg-surface-1',
              )}
            >
              <span className="text-base w-4 text-center opacity-80">{it.icon}</span>
              <span>{it.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-2 py-3 border-t border-surface-2">
        <Link
          href="/settings"
          className={clsx(
            'flex items-center gap-3 px-3 py-2 rounded text-[13px] transition-colors',
            pathname.startsWith('/settings')
              ? 'bg-surface-2 text-primary border-l-2 border-primary -ml-px'
              : 'text-ink-dim hover:text-ink hover:bg-surface-1',
          )}
        >
          <span className="text-base w-4 text-center opacity-80">⚙</span>
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
