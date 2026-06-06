'use client';

import { useRouter } from 'next/navigation';
import { fmtTokens, fmtCost, fmtDuration } from '@/lib/format';
import { displayTitle } from '@/lib/sessionDisplay';
import { CategoryBadge } from './CategoryBadge';
import { sessionCategories } from '@/lib/sessionDisplay';
import type { SessionRow as SessionRowData } from '@/lib/queries';

export function SessionRow({ session, zebra }: { session: SessionRowData; zebra?: boolean }) {
  const router = useRouter();
  const href = `/sessions/${session.id}`;
  const tokens =
    session.input_tokens + session.output_tokens + session.cache_read_tokens + session.cache_write_tokens;
  const title = displayTitle(session);
  const labels = sessionCategories(session);

  return (
    <tr
      onClick={() => router.push(href)}
      onAuxClick={(e) => {
        // Middle-click → open in new tab. Browsers fire onAuxClick for button 1.
        if (e.button === 1) window.open(href, '_blank');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(href);
      }}
      tabIndex={0}
      role="link"
      className={`border-t border-surface-2 cursor-pointer transition-colors hover:bg-surface-2/60 focus:outline-none focus:bg-surface-2/70 ${
        zebra ? 'bg-surface-1/30' : ''
      }`}
    >
      <td className="px-3 py-2 font-mono text-code-sm text-ink-mute">
        {new Date(session.started_at).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${
            session.provider === 'claude'
              ? 'bg-primary/15 text-primary'
              : 'bg-secondary/15 text-secondary'
          }`}
        >
          {session.provider}
        </span>
      </td>
      <td className="px-3 py-2 text-ink-dim">{session.project_name}</td>
      <td className="px-3 py-2 font-mono text-code-sm text-ink-mute truncate max-w-[180px]">
        {session.model || '—'}
      </td>
      <td className="px-3 py-2 max-w-[420px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-ink truncate">{title}</span>
          {labels.map((c) => <CategoryBadge key={c} category={c} />)}
        </div>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular">{fmtTokens(tokens)}</td>
      <td className="px-3 py-2 text-right font-mono tabular text-secondary">{fmtCost(session.est_cost_usd)}</td>
      <td className="px-3 py-2 text-right font-mono tabular text-ink-mute">{fmtDuration(session.duration_ms)}</td>
    </tr>
  );
}
