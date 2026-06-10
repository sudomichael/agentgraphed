import { fmtTokens, fmtCost } from '@/lib/format';
import type { TokenBreakdownSummary } from '@/lib/queries';

// Full "where your tokens went" view for the Analytics page. Same data as
// the dashboard strip but expanded:
//   1. Headline: dollar cost in window + billed-tokens-vs-unique-content
//      mismatch (cache replay multiplier).
//   2. Billing mix: fresh input / cache creation / cache read / output
//      shares of billed tokens — the real cost-shaping levers.
//   3. Per-source table split into INPUT-side (tool_result + user_text)
//      and OUTPUT-side (tool_use + assistant_text). Each row shows the
//      source, the pro-rated dollar attribution, the unique bytes that
//      flowed, and an item count.
//   4. Honest footer that explains the pro-rating and the cache caveat.

type Props = {
  summary: TokenBreakdownSummary;
  rangeLabel: string;
};

function displaySource(source: string | null, kind: string): string {
  if (kind === 'user_text') return 'Your prompts';
  if (kind === 'assistant_text') return "Claude's text replies";
  if (!source) return '(unknown)';
  if (source.startsWith('mcp__')) {
    const parts = source.slice(5).split('__');
    if (parts.length >= 2) return `MCP · ${parts[0]} · ${parts.slice(1).join('__')}`;
    return `MCP · ${parts.join('__')}`;
  }
  return source;
}

export function TokenBreakdownDetailCard({ summary, rangeLabel }: Props) {
  if (summary.rows.length === 0) return null;

  const inputRows = summary.rows.filter((r) => r.kind === 'tool_result' || r.kind === 'user_text');
  const outputRows = summary.rows.filter((r) => r.kind === 'tool_use' || r.kind === 'assistant_text');

  const inCost = inputRows.reduce((s, r) => s + r.est_cost_usd, 0);
  const outCost = outputRows.reduce((s, r) => s + r.est_cost_usd, 0);

  const billed = Math.max(1, summary.billed_tokens);
  const inPct = (summary.input_tokens / billed) * 100;
  const cwPct = (summary.cache_write_tokens / billed) * 100;
  const crPct = (summary.cache_read_tokens / billed) * 100;
  const outPct = (summary.output_tokens / billed) * 100;

  const cacheMultiplier =
    summary.unique_bytes > 0
      ? (summary.input_tokens + summary.cache_read_tokens + summary.cache_write_tokens) /
        (summary.unique_bytes / 4)
      : 0;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Where your cost went · {rangeLabel}</span>
        <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
          pro-rated estimates · see footer
        </span>
      </div>

      <div className="p-5 space-y-6">
        {/* Headline */}
        <div>
          <div className="flex items-baseline gap-4 mb-1">
            <span className="text-headline-md font-semibold text-secondary tabular">
              {fmtCost(summary.total_cost_usd)}
            </span>
            <span className="text-body-md text-ink-mute">in this range</span>
          </div>
          <div className="text-body-sm text-ink-mute font-mono">
            <span className="text-ink-dim">{fmtTokens(summary.billed_tokens)}</span> billed tokens
            <span className="mx-2">·</span>
            <span className="text-ink-dim">{fmtBytes(summary.unique_bytes)}</span> of unique content fed in
            {cacheMultiplier > 2 && (
              <>
                <span className="mx-2">·</span>
                <span className="text-ink-dim">{cacheMultiplier.toFixed(0)}×</span> cache reuse
              </>
            )}
          </div>
        </div>

        {/* Billing mix */}
        <div>
          <div className="text-[11px] text-ink-mute uppercase tracking-wider mb-2">Billing mix</div>
          <div className="flex h-3 rounded overflow-hidden mb-2">
            <Bar pct={inPct} color="#ff5e94" />
            <Bar pct={cwPct} color="#ffaa3a" />
            <Bar pct={crPct} color="#5cd0ff" />
            <Bar pct={outPct} color="#00ffab" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
            <BillStat color="#ff5e94" label="fresh input" tokens={summary.input_tokens} pct={inPct} />
            <BillStat color="#ffaa3a" label="cache creation" tokens={summary.cache_write_tokens} pct={cwPct} />
            <BillStat color="#5cd0ff" label="cache read (cheap)" tokens={summary.cache_read_tokens} pct={crPct} />
            <BillStat color="#00ffab" label="output" tokens={summary.output_tokens} pct={outPct} />
          </div>
        </div>

        {/* Sources */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SourceList
            title="What Claude read"
            subtitle={`${fmtCost(inCost)} · ${inPct.toFixed(0) + crPct.toFixed(0) + cwPct.toFixed(0)}% of billed in this window`}
            rows={inputRows.map((r) => ({
              label: displaySource(r.source, r.kind),
              detail: `${r.items} ${r.items === 1 ? 'item' : 'items'} · ${fmtBytes(r.bytes)}`,
              cost: r.est_cost_usd,
              maxCost: Math.max(...inputRows.map((x) => x.est_cost_usd), 0.0001),
              accent: 'primary' as const,
            }))}
          />
          <SourceList
            title="What Claude said"
            subtitle={`${fmtCost(outCost)} · output-side`}
            rows={outputRows.map((r) => ({
              label: displaySource(r.source, r.kind) + (r.kind === 'tool_use' ? ' · call args' : ''),
              detail: `${r.items} ${r.items === 1 ? 'item' : 'items'} · ${fmtBytes(r.bytes)}`,
              cost: r.est_cost_usd,
              maxCost: Math.max(...outputRows.map((x) => x.est_cost_usd), 0.0001),
              accent: 'secondary' as const,
            }))}
          />
        </div>

        {/* Honest footer */}
        <div className="text-[11px] text-ink-mute border-t border-surface-2 pt-3 space-y-1 leading-relaxed">
          <p>
            Per-source <span className="text-ink-dim">$</span> figures are pro-rated:
            we take the session&apos;s actual <span className="font-mono">est_cost_usd</span> and
            split it across content items by their share of unique bytes. Input-side cost is
            split among tool results + your prompts; output-side cost is split among tool calls
            + Claude&apos;s text.
          </p>
          <p>
            We can&apos;t observe which individual reads landed in fresh input vs cache,
            so the per-source split assumes each byte of a kind paid the same average rate.
            That means a Read whose contents got cached is undercredited and a Read that
            arrived fresh is overcredited. The headline cost is exact; the source split is
            an honest estimate.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  if (pct < 0.5) return null;
  return <div style={{ width: `${pct}%`, backgroundColor: color }} />;
}

function BillStat({ color, label, tokens, pct }: { color: string; label: string; tokens: number; pct: number }) {
  return (
    <div className="flex items-center gap-2 text-ink-mute">
      <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">
        <span className="text-ink-dim">{label}</span>
        <span className="ml-1">{pct.toFixed(0)}%</span>
        <span className="ml-1 text-ink-mute">({fmtTokens(tokens)})</span>
      </span>
    </div>
  );
}

type SourceListRow = {
  label: string;
  detail: string;
  cost: number;
  maxCost: number;
  accent: 'primary' | 'secondary';
};

function SourceList({ title, subtitle, rows }: { title: string; subtitle: string; rows: SourceListRow[] }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-body-md text-ink">{title}</span>
        <span className="text-[11px] text-ink-mute font-mono normal-case tracking-normal">{subtitle}</span>
      </div>
      <div className="space-y-2">
        {rows.length === 0 && (
          <div className="text-body-sm text-ink-mute">No data in this group.</div>
        )}
        {rows.map((r) => {
          const pct = (r.cost / r.maxCost) * 100;
          const barClass = r.accent === 'primary' ? 'bg-primary/70' : 'bg-secondary/70';
          return (
            <div key={r.label} className="space-y-1">
              <div className="flex items-baseline justify-between text-body-sm">
                <span className="text-ink-dim truncate pr-2">
                  {r.label}
                  <span className="text-ink-mute font-mono text-[11px] ml-2">{r.detail}</span>
                </span>
                <span className="font-mono text-ink tabular text-code-sm whitespace-nowrap">
                  ≈{fmtCost(r.cost)}
                </span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div className={`h-full ${barClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}
