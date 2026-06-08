import { fmtTokens, fmtCost } from '@/lib/format';
import { normalizeModelName } from '@/lib/pricing';

// Compact dashboard card showing usage rolled up by model family (e.g.
// "claude-opus-4-7" + "claude-opus-4-6" → "Claude Opus 4"). Ranked by tokens
// for honest visual weighting — bars normalize to the top entry.

type Row = { model: string; sessions: number; tokens: number; cost: number };

export function ModelBreakdownCard({
  rows,
  label,
}: {
  rows: Row[];
  label: string;
}) {
  // Collapse raw model_ids into families. Database has e.g. "claude-opus-4-7"
  // and "claude-opus-4-6" as separate rows; we want one "Claude Opus 4" entry.
  const families = new Map<string, { sessions: number; tokens: number; cost: number }>();
  for (const r of rows) {
    const family = normalizeModelName(r.model);
    const acc = families.get(family);
    if (acc) {
      acc.sessions += r.sessions;
      acc.tokens += r.tokens;
      acc.cost += r.cost;
    } else {
      families.set(family, { sessions: r.sessions, tokens: r.tokens, cost: r.cost });
    }
  }
  const ranked = [...families.entries()]
    .map(([family, v]) => ({ family, ...v }))
    .sort((a, b) => b.cost - a.cost);

  const maxCost = Math.max(...ranked.map((r) => r.cost), 0.000001);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>By Model · {label}</span>
        <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">cost</span>
      </div>
      <div className="p-4 space-y-2.5">
        {ranked.map((r) => {
          const pct = (r.cost / maxCost) * 100;
          return (
            <div key={r.family} className="space-y-1">
              <div className="flex items-baseline justify-between text-body-sm">
                <span className="text-ink truncate pr-2">{r.family}</span>
                <span className="font-mono text-ink-mute tabular text-code-sm whitespace-nowrap">
                  {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'} · {fmtTokens(r.tokens)} · <span className="text-secondary">{fmtCost(r.cost)}</span>
                </span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div className="h-full bg-secondary/70" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {ranked.length === 0 && (
          <div className="text-body-sm text-ink-mute text-center py-4">No model usage in this range.</div>
        )}
      </div>
    </div>
  );
}
