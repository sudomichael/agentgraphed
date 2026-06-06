'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { fmtTokens } from '@/lib/format';

type Point = { day: string; sessions: number; tokens: number; cost: number };
type Metric = 'tokens' | 'sessions' | 'cost';

// On a log axis, zero is undefined — Recharts drops the point and leaves a gap.
// Clamp zero values to a tiny positive number so the line stays continuous and
// visually still reads as "basically zero" (it sits at the bottom of the axis).
const LOG_FLOOR = 1;

export function UsageChart({ data, metric = 'tokens', scale = 'lin' }: { data: Point[]; metric?: Metric; scale?: 'lin' | 'log' }) {
  const series = data.map((d) => {
    const raw = d[metric] as number;
    const value = scale === 'log' && raw <= 0 ? LOG_FLOOR : raw;
    return { ...d, label: d.day.slice(5), value, raw };
  });
  const color = metric === 'cost' ? '#00ffab' : '#00f5ff';
  const yScale: 'auto' | 'log' = scale === 'log' ? 'log' : 'auto';

  return (
    <div className="h-64 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={`grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={{ stroke: '#262a31' }}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis
            scale={yScale}
            domain={scale === 'log' ? [LOG_FLOOR, 'auto'] : ['auto', 'auto']}
            allowDataOverflow
            tick={{ fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (metric === 'cost' ? `$${Math.round(v as number)}` : fmtTokens(v as number))}
          />
          <Tooltip
            cursor={{ stroke: color, strokeOpacity: 0.3 }}
            contentStyle={{
              background: '#181c22',
              border: `1px solid ${color}`,
              borderRadius: 6,
              fontSize: 12,
              color: '#dfe2eb',
            }}
            formatter={(_v: number, _name: string, item) => {
              const raw = (item?.payload as { raw: number })?.raw ?? 0;
              if (metric === 'tokens') return [fmtTokens(raw), 'tokens'];
              if (metric === 'sessions') return [raw.toString(), 'sessions'];
              return [`$${raw.toFixed(2)}`, 'cost'];
            }}
            labelFormatter={(l) => `Day ${l}`}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#grad-${metric})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
