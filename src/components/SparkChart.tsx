'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { fmtTokens } from '@/lib/format';

type Point = { day: string; sessions: number; tokens: number; cost: number };
type Metric = 'tokens' | 'sessions' | 'cost' | 'breakdown';
type ChartMode = 'area' | 'bar';

// Stacked-breakdown payloads share the `day` field but carry one numeric
// per source column. We render them with a separate code path because
// Recharts' typing wants one <Area>/<Bar> per dataKey.
type BreakdownPoint = { day: string } & Record<string, number | string>;

const LOG_FLOOR = 1;

// Color palette for breakdown stacks. Repeating gracefully; the eye reads
// the top 4-5 stacked colors fine.
const STACK_COLORS = [
  '#00f5ff', // primary cyan
  '#00ffab', // secondary green
  '#ffaa3a', // amber
  '#ff5e94', // pink
  '#a76dff', // violet
  '#5cd0ff', // lighter cyan
  '#7df0a8', // lighter green
  '#ffc977', // light amber
];

export function UsageChart({
  data,
  metric = 'tokens',
  scale = 'lin',
  chart = 'area',
  breakdown,
}: {
  data: Point[];
  metric?: Metric;
  scale?: 'lin' | 'log';
  chart?: ChartMode;
  // When provided AND metric==='breakdown' we render the stacked view.
  breakdown?: { buckets: BreakdownPoint[]; sources: string[] };
}) {
  const breakdownMode = metric === 'breakdown' && breakdown && breakdown.buckets.length > 0;
  if (breakdownMode) return <BreakdownChart breakdown={breakdown} chart={chart} scale={scale} />;

  // Past the breakdown-mode early return, metric is always a scalar key on Point.
  const scalarMetric = metric as 'tokens' | 'sessions' | 'cost';
  const hourly = data.length > 0 && data[0].day.length > 10;
  const series = data.map((d) => {
    const raw = d[scalarMetric] as number;
    const value = scale === 'log' && raw <= 0 ? LOG_FLOOR : raw;
    const label = hourly ? d.day.slice(11, 16) : d.day.slice(5);
    return { ...d, label, value, raw };
  });
  const color = scalarMetric === 'cost' ? '#00ffab' : '#00f5ff';
  const yScale: 'auto' | 'log' = scale === 'log' ? 'log' : 'auto';
  const gradientId = `grad-${scalarMetric}-${chart}`;

  const axisTickStyle = { fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' };
  const tooltipContentStyle = {
    background: '#181c22',
    border: `1px solid ${color}`,
    borderRadius: 6,
    fontSize: 12,
    color: '#dfe2eb',
  };
  const tooltipFormatter = (_v: number, _name: string, item: { payload?: { raw?: number } }) => {
    const raw = item?.payload?.raw ?? 0;
    if (scalarMetric === 'tokens') return [fmtTokens(raw), 'tokens'] as [string, string];
    if (scalarMetric === 'sessions') return [raw.toString(), 'sessions'] as [string, string];
    return [`$${raw.toFixed(2)}`, 'cost'] as [string, string];
  };
  const yTickFormatter = (v: number | string) =>
    scalarMetric === 'cost' ? `$${Math.round(Number(v))}` : fmtTokens(Number(v));
  const labelFormatter = (l: string) => (hourly ? `Hour ${l}` : `Day ${l}`);

  return (
    <div className="h-64 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        {chart === 'bar' ? (
          <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.85} />
                <stop offset="100%" stopColor={color} stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={axisTickStyle} axisLine={{ stroke: '#262a31' }} tickLine={false} minTickGap={48} />
            <YAxis
              scale={yScale}
              domain={scale === 'log' ? [LOG_FLOOR, 'auto'] : ['auto', 'auto']}
              allowDataOverflow
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
              tickFormatter={yTickFormatter}
            />
            <Tooltip
              cursor={{ fill: color, fillOpacity: 0.08 }}
              contentStyle={tooltipContentStyle}
              formatter={tooltipFormatter}
              labelFormatter={labelFormatter}
            />
            <Bar dataKey="value" fill={`url(#${gradientId})`} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        ) : (
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={axisTickStyle} axisLine={{ stroke: '#262a31' }} tickLine={false} minTickGap={48} />
            <YAxis
              scale={yScale}
              domain={scale === 'log' ? [LOG_FLOOR, 'auto'] : ['auto', 'auto']}
              allowDataOverflow
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
              tickFormatter={yTickFormatter}
            />
            <Tooltip
              cursor={{ stroke: color, strokeOpacity: 0.3 }}
              contentStyle={tooltipContentStyle}
              formatter={tooltipFormatter}
              labelFormatter={labelFormatter}
            />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} isAnimationActive={false} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function BreakdownChart({
  breakdown,
  chart,
  scale,
}: {
  breakdown: { buckets: BreakdownPoint[]; sources: string[] };
  chart: ChartMode;
  scale: 'lin' | 'log';
}) {
  const { buckets, sources } = breakdown;
  // `day` carries hourly suffix when length > 10 — same convention as the
  // scalar chart, so the X-axis labels stay consistent across toggles.
  const hourly = buckets.length > 0 && String(buckets[0].day).length > 10;
  const series = buckets.map((b) => {
    const label = hourly ? String(b.day).slice(11, 16) : String(b.day).slice(5);
    return { ...b, label };
  });

  const axisTickStyle = { fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' };
  // Log scale doesn't compose meaningfully with stacked area — log of a sum
  // isn't the sum of logs. We honor the scale toggle by hiding the legend's
  // stack illusion in log mode (each series renders independently). In bar
  // mode the same applies. Easier path: ignore scale in breakdown mode.
  void scale;

  const colorFor = (i: number) => STACK_COLORS[i % STACK_COLORS.length];
  const yTickFormatter = (v: number | string) => `$${Math.round(Number(v))}`;
  const labelFormatter = (l: string) => (hourly ? `Hour ${l}` : `Day ${l}`);
  const tooltipFormatter = (v: number, name: string) => [`$${v.toFixed(2)}`, name] as [string, string];

  return (
    <div className="h-64 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        {chart === 'bar' ? (
          <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={axisTickStyle} axisLine={{ stroke: '#262a31' }} tickLine={false} minTickGap={48} />
            <YAxis
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
              tickFormatter={yTickFormatter}
            />
            <Tooltip
              cursor={{ fill: '#ffffff', fillOpacity: 0.04 }}
              contentStyle={{ background: '#181c22', border: '1px solid #262a31', borderRadius: 6, fontSize: 12, color: '#dfe2eb' }}
              formatter={tooltipFormatter}
              labelFormatter={labelFormatter}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', paddingTop: 6 }} iconSize={8} />
            {sources.map((s, i) => (
              <Bar key={s} dataKey={s} stackId="cost" fill={colorFor(i)} isAnimationActive={false} radius={i === sources.length - 1 ? [2, 2, 0, 0] : 0} />
            ))}
          </BarChart>
        ) : (
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={axisTickStyle} axisLine={{ stroke: '#262a31' }} tickLine={false} minTickGap={48} />
            <YAxis
              tick={axisTickStyle}
              axisLine={false}
              tickLine={false}
              tickFormatter={yTickFormatter}
            />
            <Tooltip
              cursor={{ stroke: '#ffffff', strokeOpacity: 0.2 }}
              contentStyle={{ background: '#181c22', border: '1px solid #262a31', borderRadius: 6, fontSize: 12, color: '#dfe2eb' }}
              formatter={tooltipFormatter}
              labelFormatter={labelFormatter}
            />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono', paddingTop: 6 }} iconSize={8} />
            {sources.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stackId="cost"
                stroke={colorFor(i)}
                fill={colorFor(i)}
                fillOpacity={0.7}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
