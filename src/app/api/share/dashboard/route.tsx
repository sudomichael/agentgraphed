// GET /api/share/dashboard?days=7|30|90|all&metric=tokens|sessions|cost&scale=lin|log
// — generates a 1200x630 PNG summary card with the user's headline stats and
// the daily usage chart that's currently on screen.

import { ImageResponse } from 'next/og';
import { getRangeSummary, getDailySeries, getProject } from '@/lib/queries';
import { fmtTokens, fmtCost } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;
const BG = '#10141a';
const SURFACE = '#181c22';
const SURFACE_BORDER = '#262a31';
const INK = '#dfe2eb';
const INK_DIM = '#b9caca';
const INK_MUTE = '#849495';
const PRIMARY = '#00f5ff';
const SECONDARY = '#00ffab';

type Metric = 'tokens' | 'sessions' | 'cost';
type Scale = 'lin' | 'log';
type ChartMode = 'area' | 'bar';
type Point = { day: string; sessions: number; tokens: number; cost: number };

function rangeLabel(days: number | null): string {
  if (days === null) return 'all-time';
  if (days === 1) return 'last 24h';
  if (days === 7) return 'last 7 days';
  if (days === 30) return 'last 30 days';
  if (days === 90) return 'last 90 days';
  return `last ${days} days`;
}

function metricLabel(m: Metric): string {
  return m === 'tokens' ? 'Tokens' : m === 'sessions' ? 'Sessions' : 'Est. Cost';
}

function fmtY(value: number, m: Metric): string {
  if (m === 'tokens') return fmtTokens(value);
  if (m === 'sessions') return value.toString();
  return `$${Math.round(value)}`;
}

// Match SparkChart's log handling — clamp zeros to a small positive so the bar
// still has nonzero height instead of vanishing.
const LOG_FLOOR = 1;

type Bar = { x: number; y: number; w: number; h: number };

function buildChart(points: Point[], metric: Metric, scale: Scale, mode: ChartMode, x: number, y: number, w: number, h: number) {
  if (points.length === 0) {
    return { area: '', line: '', bars: [] as Bar[], gridLines: [] as { y: number; label: string }[] };
  }

  const raw = points.map((p) => p[metric] as number);
  const transform = (v: number) => {
    if (scale === 'log') {
      const clamped = v <= 0 ? LOG_FLOOR : v;
      return Math.log10(clamped);
    }
    return v;
  };
  const values = raw.map(transform);
  const max = Math.max(...values, scale === 'log' ? Math.log10(LOG_FLOOR) : 0);
  const min = scale === 'log' ? Math.log10(LOG_FLOOR) : 0;
  const range = Math.max(max - min, 0.0001);

  const xAt = (i: number) => x + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const yAt = (v: number) => y + h - ((v - min) / range) * h;

  // Path mode (area + line)
  let line = '';
  let area = '';
  if (mode === 'area') {
    for (let i = 0; i < points.length; i++) {
      const px = xAt(i);
      const py = yAt(values[i]);
      line += (i === 0 ? 'M' : 'L') + ` ${px.toFixed(2)} ${py.toFixed(2)} `;
    }
    area = line + `L ${xAt(points.length - 1).toFixed(2)} ${(y + h).toFixed(2)} L ${xAt(0).toFixed(2)} ${(y + h).toFixed(2)} Z`;
  }

  // Bar mode: width per bucket = (chartWidth - gap*(n-1)) / n with a small gap.
  const bars: Bar[] = [];
  if (mode === 'bar') {
    const n = points.length;
    const gapPct = n > 60 ? 0.1 : n > 20 ? 0.2 : 0.3;
    const bucketW = w / n;
    const barW = Math.max(1, bucketW * (1 - gapPct));
    for (let i = 0; i < n; i++) {
      const cx = x + bucketW * (i + 0.5);
      const top = yAt(values[i]);
      // For zero values in lin mode, top == y+h, so the bar has zero height.
      // That's fine — Recharts does the same. Log mode floors to LOG_FLOOR.
      const barH = Math.max(0, y + h - top);
      bars.push({ x: cx - barW / 2, y: top, w: barW, h: barH });
    }
  }

  // 3 gridline labels: max, mid, base
  const gridLines = [0.5, 0].map((frac) => {
    const v = min + range * (1 - frac);
    const raw = scale === 'log' ? Math.pow(10, v) : v;
    return { y: yAt(v), label: fmtY(raw, metric) };
  });
  gridLines.unshift({ y: y, label: fmtY(scale === 'log' ? Math.pow(10, max) : max, metric) });

  return { area, line, bars, gridLines };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('days') ?? '30';
  const days: number | null = raw === 'all' ? null : Math.max(1, parseInt(raw, 10) || 30);
  const metricParam = url.searchParams.get('metric');
  const metric: Metric =
    metricParam === 'sessions' || metricParam === 'cost' ? metricParam : 'tokens';
  const scaleParam = url.searchParams.get('scale');
  const scale: Scale = scaleParam === 'log' ? 'log' : 'lin';
  const chartParam = url.searchParams.get('chart');
  const chartMode: ChartMode = chartParam === 'bar' ? 'bar' : 'area';
  const projectId = url.searchParams.get('project');
  const project = projectId ? getProject(projectId) : null;
  const modelFamily = url.searchParams.get('model');

  const summary = getRangeSummary(days, projectId, modelFamily);
  const daily = getDailySeries(days, projectId, modelFamily);

  const color = metric === 'cost' ? SECONDARY : PRIMARY;

  // Chart geometry (SVG viewport is the same size as the rendered <svg>).
  const CHART_W = 1072;
  const CHART_H = 220;
  const PAD_L = 56;
  const PAD_R = 8;
  const PAD_T = 8;
  const PAD_B = 24;
  const innerW = CHART_W - PAD_L - PAD_R;
  const innerH = CHART_H - PAD_T - PAD_B;

  const { area, line, bars, gridLines } = buildChart(daily, metric, scale, chartMode, PAD_L, PAD_T, innerW, innerH);

  // Day key carries `YYYY-MM-DD` (daily) or `YYYY-MM-DD HH:00` (hourly).
  // Slice differently so the X-axis shows `HH:00` when zoomed into a day.
  const hourly = daily.length > 0 && daily[0].day.length > 10;
  const xLabelOf = (day: string) => (hourly ? day.slice(11, 16) : day.slice(5));

  // X-axis labels: first, middle, last bucket (compact).
  const xLabels: { x: number; label: string }[] = [];
  if (daily.length > 0) {
    const indices = daily.length === 1 ? [0] : [0, Math.floor(daily.length / 2), daily.length - 1];
    for (const i of indices) {
      const px = PAD_L + (daily.length === 1 ? innerW / 2 : (i / (daily.length - 1)) * innerW);
      xLabels.push({ x: px, label: xLabelOf(daily[i].day) });
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, backgroundColor: BG, color: INK,
          display: 'flex', flexDirection: 'column',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 64,
        }}
      >
        {/* Brand bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 28, backgroundColor: PRIMARY, borderRadius: 3, display: 'flex' }} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, display: 'flex' }}>
            <div style={{ display: 'flex', color: INK_DIM }}>Agent</div>
            <div style={{ display: 'flex', color: PRIMARY }}>Graphed</div>
          </div>
          <div style={{
            marginLeft: 14, color: INK_MUTE, fontSize: 13, letterSpacing: 1.5,
            textTransform: 'uppercase', display: 'flex',
          }}>{metricLabel(metric)} · {rangeLabel(days)}{scale === 'log' ? ' · log' : ''}{chartMode === 'bar' ? ' · bar' : ''}{project ? ` · ${project.name}` : ''}{modelFamily ? ` · ${modelFamily}` : ''}</div>
        </div>

        {/* Headline metrics row */}
        <div style={{ marginTop: 36, display: 'flex', gap: 16 }}>
          <Big label="Tokens" value={fmtTokens(summary.tokens)} accent={metric === 'tokens' ? PRIMARY : undefined} />
          <Big label="Sessions" value={summary.sessions.toLocaleString()} accent={metric === 'sessions' ? PRIMARY : undefined} />
          <Big label="Projects" value={summary.projects.toString()} />
          <Big label="Est. Cost" value={fmtCost(summary.cost)} accent={metric === 'cost' ? SECONDARY : undefined} />
        </div>

        {/* Chart */}
        <div style={{
          marginTop: 28, flex: 1, display: 'flex',
          backgroundColor: SURFACE, border: `1px solid ${SURFACE_BORDER}`,
          borderRadius: 8, padding: '12px 16px', flexDirection: 'column',
        }}>
          {daily.length === 0 ? (
            <div style={{
              display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center',
              color: INK_MUTE, fontSize: 18,
            }}>No data in this range.</div>
          ) : (
            // Satori (the renderer behind next/og) doesn't support <text>
            // SVG nodes. We render the chart as positioned <div>s plus an
            // <svg> containing only <path>/<rect>, which Satori does
            // accept. Text labels (gridline values, x-axis days) become
            // absolutely-positioned divs.
            <div style={{
              position: 'relative', display: 'flex',
              width: CHART_W, height: CHART_H,
            }}>
              {/* Y-axis grid lines + labels (rendered as divs) */}
              {gridLines.map((g, i) => (
                <div
                  key={`grid-${i}`}
                  style={{
                    position: 'absolute', display: 'flex',
                    left: PAD_L, top: g.y, width: CHART_W - PAD_L - PAD_R,
                    height: 1, backgroundColor: SURFACE_BORDER,
                  }}
                />
              ))}
              {gridLines.map((g, i) => (
                <div
                  key={`ylabel-${i}`}
                  style={{
                    position: 'absolute', display: 'flex',
                    left: 0, top: g.y - 6,
                    width: PAD_L - 10, justifyContent: 'flex-end',
                    color: INK_MUTE, fontSize: 12, fontFamily: 'monospace',
                  }}
                >
                  {g.label}
                </div>
              ))}

              {/* The chart curve / bars — Satori has flaky support for SVG
                  gradients and fragments, so we use solid colors and
                  render each shape as its own top-level <svg>. */}
              {chartMode === 'area' && (
                <svg
                  width={CHART_W} height={CHART_H}
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  style={{ display: 'block', position: 'absolute', left: 0, top: 0 }}
                >
                  <path d={area} fill={color} fillOpacity={0.25} />
                  <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                </svg>
              )}
              {chartMode === 'bar' && (
                <svg
                  width={CHART_W} height={CHART_H}
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  style={{ display: 'block', position: 'absolute', left: 0, top: 0 }}
                >
                  {bars.map((b, i) => (
                    <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={color} rx={2} />
                  ))}
                </svg>
              )}

              {/* X-axis labels */}
              {xLabels.map((l, i) => {
                // Anchor: first = left, last = right, middle = center
                const isFirst = i === 0;
                const isLast = i === xLabels.length - 1;
                const width = 80;
                const left = isFirst ? l.x : isLast ? l.x - width : l.x - width / 2;
                const justify = isFirst ? 'flex-start' : isLast ? 'flex-end' : 'center';
                return (
                  <div
                    key={`xlabel-${i}`}
                    style={{
                      position: 'absolute', display: 'flex',
                      left, top: CHART_H - 18, width,
                      justifyContent: justify,
                      color: INK_MUTE, fontSize: 12, fontFamily: 'monospace',
                    }}
                  >
                    {l.label}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: INK_MUTE, fontSize: 15, fontFamily: 'monospace',
        }}>
          <div style={{ display: 'flex', color: INK_DIM }}>Your AI coding activity, graphed.</div>
          <div style={{ display: 'flex' }}>agentgraphed.com</div>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}

function Big({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      flex: 1, backgroundColor: SURFACE, border: `1px solid ${SURFACE_BORDER}`,
      borderRadius: 8, padding: '18px 22px', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        color: INK_MUTE, fontSize: 12, fontWeight: 600, letterSpacing: 1.2,
        textTransform: 'uppercase', display: 'flex',
      }}>{label}</div>
      <div style={{
        marginTop: 6, fontSize: 38, fontWeight: 600,
        color: accent || INK, fontFamily: 'monospace', display: 'flex',
      }}>{value}</div>
    </div>
  );
}
