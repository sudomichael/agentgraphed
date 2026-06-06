'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { fmtTokens, fmtCost } from '@/lib/format';

type Props = {
  daily: { day: string; sessions: number; tokens: number; cost: number }[];
  providers: { provider: string; sessions: number; tokens: number; cost: number }[];
  models: { model: string; sessions: number; tokens: number; cost: number }[];
  label?: string;
};

const PRIMARY = '#00f5ff';
const SECONDARY = '#00ffab';
const PROVIDER_COLORS: Record<string, string> = {
  claude: '#00f5ff',
  codex: '#00ffab',
  unknown: '#6E7681',
};

export function AnalyticsCharts({ daily, providers, models, label = 'last 30 days' }: Props) {
  const chartData = daily.map((d) => ({
    ...d,
    label: d.day.slice(5),
  }));

  return (
    <div className="space-y-7">
      <div className="card">
        <div className="card-header">Activity Over Time — {label}</div>
        <div className="p-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
              <defs>
                <linearGradient id="tokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={PRIMARY} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={{ stroke: '#262a31' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtTokens(v as number)}
              />
              <Tooltip
                cursor={{ stroke: '#00f5ff', strokeOpacity: 0.3 }}
                contentStyle={{
                  background: '#181c22',
                  border: '1px solid #00f5ff',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#dfe2eb',
                }}
                formatter={(v: number) => fmtTokens(v)}
                labelFormatter={(l) => `Day ${l}`}
              />
              <Area type="monotone" dataKey="tokens" stroke={PRIMARY} strokeWidth={2} fill="url(#tokens)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <div className="card-header">Sessions Per Day</div>
          <div className="p-4 h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid stroke="#262a31" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#849495', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={{ stroke: '#262a31' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#849495', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: '#181c22',
                    border: '1px solid #00ffab',
                    borderRadius: 6,
                    fontSize: 12,
                    color: '#dfe2eb',
                  }}
                />
                <Bar dataKey="sessions" fill={SECONDARY} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Provider Breakdown</div>
          <div className="p-4 h-60 flex items-center gap-4">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie
                  data={providers}
                  dataKey="tokens"
                  nameKey="provider"
                  innerRadius={45}
                  outerRadius={75}
                  stroke="#10141a"
                  strokeWidth={2}
                >
                  {providers.map((p) => (
                    <Cell key={p.provider} fill={PROVIDER_COLORS[p.provider] || '#6E7681'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#181c22',
                    border: '1px solid #00f5ff',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => fmtTokens(v)}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {providers.map((p) => (
                <div key={p.provider} className="flex items-center gap-2 text-body-sm">
                  <div
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ background: PROVIDER_COLORS[p.provider] || '#6E7681' }}
                  />
                  <span className="text-ink-dim capitalize flex-1">{p.provider}</span>
                  <span className="font-mono tabular text-ink">{fmtTokens(p.tokens)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Model Breakdown</div>
        <div className="p-4 space-y-2">
          {models.map((m) => {
            const max = Math.max(...models.map((x) => x.tokens), 1);
            const pct = (m.tokens / max) * 100;
            return (
              <div key={m.model}>
                <div className="flex justify-between text-body-sm mb-1">
                  <span className="font-mono text-code-md text-ink truncate pr-2">{m.model}</span>
                  <span className="font-mono tabular text-ink-mute">
                    {fmtTokens(m.tokens)} · {fmtCost(m.cost)}
                  </span>
                </div>
                <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
