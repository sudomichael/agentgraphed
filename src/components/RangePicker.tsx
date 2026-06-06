'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { RANGE_OPTIONS, type RangeKey } from '@/lib/range';

export function RangePicker({ current }: { current: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setRange = (next: RangeKey) => {
    const params = new URLSearchParams(sp.toString());
    if (next === '30d') params.delete('range');
    else params.set('range', next);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  return (
    <div
      className={`flex items-center gap-0.5 normal-case tracking-normal transition-opacity ${pending ? 'opacity-50' : ''}`}
    >
      {RANGE_OPTIONS.map((o) => (
        <button
          key={o.key}
          onClick={() => setRange(o.key)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors font-mono ${
            current === o.key ? 'bg-primary/15 text-primary' : 'text-ink-mute hover:text-ink-dim'
          }`}
        >
          {o.key === 'all' ? 'All' : o.key}
        </button>
      ))}
    </div>
  );
}
