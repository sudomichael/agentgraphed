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
} from 'recharts';
import { fmtTokens } from '@/lib/format';

type Point = { day: string; sessions: number; tokens: number; cost: number };
type Metric = 'tokens' | 'sessions' | 'cost';
type ChartMode = 'area' | 'bar';

// On a log axis, zero is undefined — Recharts drops the point and leaves a gap.
// Clamp zero values to a tiny positive number so the line stays continuous and
// visually still reads as "basically zero" (it sits at the bottom of the axis).
const LOG_FLOOR = 1;

export function UsageChart({
  data,
  metric = 'tokens',
  scale = 'lin',
  chart = 'area',
}: {
  data: Point[];
  metric?: Metric;
  scale?: 'lin' | 'log';
  chart?: ChartMode;
}) {
  // `day` carries `YYYY-MM-DD` for daily mode and `YYYY-MM-DD HH:00` for hourly.
  // Discriminate on length so the X-axis labels show `HH:00` instead of `MM-DD`
  // when we're zoomed into a sub-day window.
  const hourly = data.length > 0 && data[0].day.length > 10;
  const series = data.map((d) => {
    const raw = d[metric] as number;
    const value = scale === 'log' && raw <= 0 ? LOG_FLOOR : raw;
    const label = hourly ? d.day.slice(11, 16) : d.day.slice(5);
    return { ...d, label, value, raw };
  });
  const color = metric === 'cost' ? '#00ffab' : '#00f5ff';
  const yScale: 'auto' | 'log' = scale === 'log' ? 'log' : 'auto';
  const gradientId = `grad-${metric}-${chart}`;

  // Recharts requires axis / grid / tooltip components to be direct children
  // of the chart wrapper — they can't be nested inside a fragment or function
  // component. So we render them inline in each branch despite the small
  // duplication.
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
    if (metric === 'tokens') return [fmtTokens(raw), 'tokens'] as [string, string];
    if (metric === 'sessions') return [raw.toString(), 'sessions'] as [string, string];
    return [`$${raw.toFixed(2)}`, 'cost'] as [string, string];
  };
  const yTickFormatter = (v: number | string) =>
    metric === 'cost' ? `$${Math.round(Number(v))}` : fmtTokens(Number(v));
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
