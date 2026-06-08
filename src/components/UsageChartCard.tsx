'use client';

import { useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { UsageChart } from './SparkChart';

type Point = { day: string; sessions: number; tokens: number; cost: number };
type Metric = 'tokens' | 'sessions' | 'cost';
type Scale = 'lin' | 'log';

// When the peak value is >> the typical day, linear scale flattens everything
// else into invisibility. Suggest log automatically.
function suggestLog(data: Point[], metric: Metric): boolean {
  const values = data.map((d) => d[metric] as number).filter((v) => v > 0);
  if (values.length < 5) return false;
  const sorted = [...values].sort((a, b) => a - b);
  const peak = sorted[sorted.length - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  return peak / Math.max(median, 1) > 10;
}

export function UsageChartCard({
  data,
  label = 'last 30 days',
  metric,
  scale,
}: {
  data: Point[];
  label?: string;
  metric: Metric;
  scale: Scale | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const recommended = useMemo<Scale>(() => (suggestLog(data, metric) ? 'log' : 'lin'), [data, metric]);
  const activeScale: Scale = scale ?? recommended;

  const setParam = (key: 'metric' | 'scale', value: string | null, defaultValue: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value === null || value === defaultValue) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const tabs: { id: Metric; label: string }[] = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'cost', label: 'Est. Cost' },
  ];

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Usage — {label}</span>
        <div className="flex items-center gap-3 normal-case tracking-normal">
          <div className="flex items-center gap-0.5">
            {tabs.map((t) => (
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
          <div className="flex items-center gap-0.5">
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
        </div>
      </div>
      <div className="p-4">
        <UsageChart data={data} metric={metric} scale={activeScale} />
      </div>
    </div>
  );
}
