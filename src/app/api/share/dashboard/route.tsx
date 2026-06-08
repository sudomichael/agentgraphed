// GET /api/share/dashboard?days=7|30|90|all — generates a 1200x630 PNG
// summary card of the user's headline stats for the chosen range.

import { ImageResponse } from 'next/og';
import {
  getRangeSummary,
  getProjectBreakdown,
  getCategoryBreakdown,
} from '@/lib/queries';
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

function rangeLabel(days: number | null): string {
  if (days === null) return 'all-time';
  if (days === 7) return 'last 7 days';
  if (days === 30) return 'last 30 days';
  if (days === 90) return 'last 90 days';
  return `last ${days} days`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('days') ?? '30';
  const days: number | null = raw === 'all' ? null : Math.max(1, parseInt(raw, 10) || 30);

  const summary = getRangeSummary(days);
  const topProjects = getProjectBreakdown(days, 3);
  const topCategories = getCategoryBreakdown(days).slice(0, 2);

  const topProjectNames = topProjects.map((p) => p.name).filter(Boolean);
  const topProjectLine =
    topProjectNames.length === 0
      ? '—'
      : topProjectNames.length === 1
        ? topProjectNames[0]
        : topProjectNames.length === 2
          ? `${topProjectNames[0]} & ${topProjectNames[1]}`
          : `${topProjectNames[0]}, ${topProjectNames[1]} & ${topProjectNames[2]}`;
  const topCategoryLine = topCategories.length === 0 ? '—' : topCategories.map((c) => c.category).join(' · ');

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 28, backgroundColor: PRIMARY, borderRadius: 3, display: 'flex' }} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, display: 'flex' }}>
            <div style={{ display: 'flex', color: INK_DIM }}>Agent</div>
            <div style={{ display: 'flex', color: PRIMARY }}>Graphed</div>
          </div>
          <div style={{
            marginLeft: 14, color: INK_MUTE, fontSize: 13, letterSpacing: 1.5,
            textTransform: 'uppercase', display: 'flex',
          }}>Summary · {rangeLabel(days)}</div>
        </div>

        {/* Headline metrics row */}
        <div style={{ marginTop: 56, display: 'flex', gap: 16 }}>
          <Big label="Tokens" value={fmtTokens(summary.tokens)} accent={PRIMARY} />
          <Big label="Sessions" value={summary.sessions.toLocaleString()} />
          <Big label="Projects" value={summary.projects.toString()} />
          <Big label="Est. Cost" value={fmtCost(summary.cost)} accent={SECONDARY} />
        </div>

        {/* Context lines */}
        <div style={{
          marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10,
          color: INK_DIM, fontSize: 22,
        }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ display: 'flex', color: INK_MUTE, textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 13, paddingTop: 6 }}>
              Top projects
            </div>
            <div style={{ display: 'flex' }}>{truncate(topProjectLine, 60)}</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ display: 'flex', color: INK_MUTE, textTransform: 'uppercase', letterSpacing: 1.5, fontSize: 13, paddingTop: 6 }}>
              Mostly
            </div>
            <div style={{ display: 'flex' }}>{truncate(topCategoryLine, 60)}</div>
          </div>
        </div>

        <div style={{
          marginTop: 22, display: 'flex', justifyContent: 'flex-end',
          color: INK_MUTE, fontSize: 17, fontFamily: 'monospace',
        }}>
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
      borderRadius: 8, padding: '22px 24px', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        color: INK_MUTE, fontSize: 13, fontWeight: 600, letterSpacing: 1.2,
        textTransform: 'uppercase', display: 'flex',
      }}>{label}</div>
      <div style={{
        marginTop: 8, fontSize: 44, fontWeight: 600,
        color: accent || INK, fontFamily: 'monospace', display: 'flex',
      }}>{value}</div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
