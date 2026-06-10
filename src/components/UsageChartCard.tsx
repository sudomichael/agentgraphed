'use client';

import { useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { UsageChart } from './SparkChart';

type Point = { day: string; sessions: number; tokens: number; cost: number };
type Metric = 'tokens' | 'sessions' | 'cost' | 'breakdown';
type Scale = 'lin' | 'log';
type ChartMode = 'area' | 'bar';
type BreakdownPoint = { day: string } & Record<string, number | string>;

// When the peak day is >> the quiet days, linear scale flattens everything
// below the peak into the X-axis baseline. Use p10 (not median) to catch
// long-tailed histories where many quiet days are visible-vs-invisible:
// a multi-month range with one billion-token day and a baseline of half a
// million is a textbook "show me a log chart" situation, but its median
// can sit comfortably mid-range and the median-based heuristic stays in lin.
function suggestLog(data: Point[], metric: Metric): boolean {
  // suggestLog only meaningful for scalar metrics. Breakdown ignores scale.
  if (metric === 'breakdown') return false;
  const values = data.map((d) => d[metric as 'tokens' | 'sessions' | 'cost'] as number).filter((v) => v > 0);
  if (values.length < 5) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const peak = sorted[sorted.length - 1];
  const p10 = sorted[Math.max(0, Math.floor(values.length * 0.1) - 1)];
  return peak / Math.max(p10, 1) > 50;
}

export function UsageChartCard({
  data,
  label = 'last 30 days',
  metric,
  scale,
  chart,
  breakdown,
}: {
  data: Point[];
  label?: string;
  metric: Metric;
  scale: Scale | null;
  chart: ChartMode;
  breakdown?: { buckets: BreakdownPoint[]; sources: string[] };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const recommended = useMemo<Scale>(() => (suggestLog(data, metric) ? 'log' : 'lin'), [data, metric]);
  const activeScale: Scale = scale ?? recommended;

  const setParam = (key: 'metric' | 'scale' | 'chart', value: string | null, defaultValue: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value === null || value === defaultValue) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const metricTabs: { id: Metric; label: string }[] = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'cost', label: 'Est. Cost' },
    { id: 'breakdown', label: 'Breakdown' },
  ];

  const chartTabs: { id: ChartMode; glyph: string; title: string }[] = [
    { id: 'area', glyph: '◠', title: 'Area chart' },
    { id: 'bar', glyph: '▮', title: 'Bar chart' },
  ];

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Usage — {label}</span>
        <div className="flex items-center gap-3 normal-case tracking-normal">
          <div className="flex items-center gap-0.5">
            {metricTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setParam('metric', t.id, 'tokens')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors font-mono ${
                  metric === t.id ? 'bg-primary/15 text-primary' : 'text-ink-mute hover:text-ink-dim'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-surface-3" />
          <div className={`flex items-center gap-0.5 ${metric === 'breakdown' ? 'opacity-40 pointer-events-none' : ''}`} title={metric === 'breakdown' ? 'Log scale doesn’t compose with stacked breakdown' : undefined}>
            {(['lin', 'log'] as Scale[]).map((s) => (
              <button
                key={s}
                onClick={() => setParam('scale', s, recommended)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors font-mono uppercase relative ${
                  activeScale === s ? 'bg-secondary/15 text-secondary' : 'text-ink-mute hover:text-ink-dim'
                }`}
                title={
                  s === 'log'
                    ? 'Logarithmic scale — better when one day dwarfs the rest'
                    : 'Linear scale'
                }
              >
                {s}
                {scale === null && recommended === s && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-secondary" title="auto-selected based on data range" />
                )}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-surface-3" />
          <div className="flex items-center gap-0.5">
            {chartTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setParam('chart', t.id, 'area')}
                className={`px-1.5 py-0.5 text-[11px] rounded transition-colors font-mono ${
                  chart === t.id ? 'bg-primary/15 text-primary' : 'text-ink-mute hover:text-ink-dim'
                }`}
                title={t.title}
                aria-label={t.title}
              >
                {t.glyph}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-4">
        <UsageChart data={data} metric={metric} scale={activeScale} chart={chart} breakdown={breakdown} />
      </div>
    </div>
  );
}
