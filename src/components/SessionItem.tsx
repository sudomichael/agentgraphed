import Link from 'next/link';
import { sessionCategories } from '@/lib/sessionDisplay';
import type { SessionRow } from '@/lib/queries';
import { fmtClock, fmtDuration, fmtTokens } from '@/lib/format';
import { CategoryBadge } from './CategoryBadge';
import { displayTitle } from '@/lib/sessionDisplay';

function providerColor(p: string) {
  if (p === 'claude') return 'bg-primary';
  if (p === 'codex') return 'bg-secondary';
  return 'bg-ink-mute';
}

export function SessionItem({ session }: { session: SessionRow }) {
  const title = displayTitle(session);
  const tokens = session.input_tokens + session.output_tokens + session.cache_read_tokens + session.cache_write_tokens;
  const labels = sessionCategories(session);

  return (
    <Link
      href={`/sessions/${session.id}`}
      className="flex items-stretch gap-3 border-l-2 border-surface-3 hover:border-primary transition-colors pl-3 py-2 group"
    >
      <div className="flex flex-col items-center pt-1 min-w-[60px]">
        <div className="font-mono text-code-sm text-ink-mute tabular">{fmtClock(session.started_at)}</div>
        <div className={`w-1.5 h-1.5 rounded-full mt-2 ${providerColor(session.provider)}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-body-md text-ink truncate group-hover:text-primary transition-colors">
            {title}
          </div>
          {labels.map((c) => <CategoryBadge key={c} category={c} />)}
        </div>
        <div className="text-body-sm text-ink-mute mt-0.5 flex items-center gap-2 flex-wrap">
          <span>{session.project_name}</span>
          <span>·</span>
          <span className="font-mono text-code-sm">{session.model || 'unknown'}</span>
          <span>·</span>
          <span className="font-mono text-code-sm tabular">{fmtTokens(tokens)} tok</span>
          <span>·</span>
          <span className="font-mono text-code-sm tabular">{fmtDuration(session.duration_ms)}</span>
        </div>
      </div>
    </Link>
  );
}
