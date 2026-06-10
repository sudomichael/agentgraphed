import { fmtTokens } from '@/lib/format';
import type { TokenBreakdownSummary } from '@/lib/queries';

// Tiny one-row companion to the usage chart's Breakdown view. The chart
// answers "where is cost going by source over time"; this strip answers
// "are you actually paying retail rates on it?" via the billing-mix bar
// and the cache-reuse multiplier. Both pieces matter — a healthy cache
// pattern can make a high-cost session affordable, and a high-fresh-input
// share is the lever users can actually move (smaller contexts, more
// focused sessions).
//
// Renders nothing when we have no tool_io coverage in the window — the
// strip would mislead by showing zeros that aren't really zeros.

type Props = {
  summary: TokenBreakdownSummary;
};

export function CacheHealthStrip({ summary }: Props) {
  if (summary.billed_tokens === 0) return null;

  const billed = summary.billed_tokens;
  const inPct = (summary.input_tokens / billed) * 100;
  const cwPct = (summary.cache_write_tokens / billed) * 100;
  const crPct = (summary.cache_read_tokens / billed) * 100;
  const outPct = (summary.output_tokens / billed) * 100;

  const cacheMultiplier =
    summary.unique_bytes > 0
      ? (summary.input_tokens + summary.cache_read_tokens + summary.cache_write_tokens) /
        (summary.unique_bytes / 4)
      : 0;

  // Verdict — the actionable summary in one short clause.
  const verdict = (() => {
    if (crPct >= 80) return { tone: 'good', text: 'Healthy cache pattern — most input charged at ~10% rate.' };
    if (inPct >= 50) return { tone: 'warn', text: 'High fresh-input share — context isn’t hitting cache well.' };
    if (cwPct >= 30) return { tone: 'warn', text: 'High cache churn — context rotating out before re-use.' };
    return { tone: 'neutral', text: 'Mixed cache pattern.' };
  })();
  const verdictColor =
    verdict.tone === 'good' ? 'text-secondary'
    : verdict.tone === 'warn' ? ''
    : 'text-ink-mute';
  const verdictStyle = verdict.tone === 'warn' ? { color: '#ffaa3a' } : undefined;

  return (
    <div className="card">
      <div className="p-3 flex items-center gap-4 flex-wrap">
        {/* Bar + legend */}
        <div className="flex-1 min-w-[260px]">
          <div className="flex h-2 rounded overflow-hidden">
            <Bar pct={inPct} color="#ff5e94" title={`Fresh input: ${inPct.toFixed(1)}%`} />
            <Bar pct={cwPct} color="#ffaa3a" title={`Cache creation: ${cwPct.toFixed(1)}%`} />
            <Bar pct={crPct} color="#5cd0ff" title={`Cache read (cheap): ${crPct.toFixed(1)}%`} />
            <Bar pct={outPct} color="#00ffab" title={`Output: ${outPct.toFixed(1)}%`} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-ink-mute">
            <Legend color="#ff5e94" label="fresh input" pct={inPct} />
            <Legend color="#ffaa3a" label="cache creation" pct={cwPct} />
            <Legend color="#5cd0ff" label="cache read" pct={crPct} />
            <Legend color="#00ffab" label="output" pct={outPct} />
          </div>
        </div>

        {/* Stats + verdict */}
        <div className="flex items-center gap-4 text-[11px] font-mono">
          {cacheMultiplier > 1 && (
            <div className="text-ink-mute" title="Average times the same byte was billed (mostly via cache_read)">
              <span className="text-ink-dim">{cacheMultiplier.toFixed(0)}×</span> cache reuse
            </div>
          )}
          <div className="text-ink-mute">
            <span className="text-ink-dim">{fmtTokens(billed)}</span> billed
          </div>
        </div>
      </div>
      <div className={`px-3 pb-3 -mt-1 text-[11px] ${verdictColor} normal-case tracking-normal`} style={verdictStyle}>
        {verdict.text}
      </div>
    </div>
  );
}

function Bar({ pct, color, title }: { pct: number; color: string; title: string }) {
  if (pct < 0.5) return null;
  return <div style={{ width: `${pct}%`, backgroundColor: color }} title={title} />;
}

function Legend({ color, label, pct }: { color: string; label: string; pct: number }) {
  if (pct < 0.5) return null;
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <span className="text-ink-dim">{pct.toFixed(0)}%</span>
    </span>
  );
}
