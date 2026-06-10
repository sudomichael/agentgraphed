import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { SessionItem } from '@/components/SessionItem';
import { UsageChartCard } from '@/components/UsageChartCard';
import { CategoryBadge } from '@/components/CategoryBadge';
import { RangePicker } from '@/components/RangePicker';
import { FreshnessIndicator } from '@/components/FreshnessIndicator';
import { ShareButton } from '@/components/ShareButton';
import { ProjectFilter } from '@/components/ProjectFilter';
import { ModelFilter } from '@/components/ModelFilter';
import { ModelBreakdownCard } from '@/components/ModelBreakdownCard';
import { CacheHealthStrip } from '@/components/CacheHealthStrip';
import { ClassifyChip } from '@/components/ClassifyChip';
import {
  getOverview,
  getRangeSummary,
  getDailySeries,
  getProjectBreakdown,
  getCategoryBreakdown,
  getTodaySessions,
  getRecentSessions,
  getDaySummary,
  getProjects,
  getSetting,
  getUnclassifiedCount,
  getModelBreakdown,
  getModelFamilies,
  getTokenBreakdown,
  getTokenBreakdownSeries,
} from '@/lib/queries';
import { triggerBackgroundIngest, lastIngestedAt } from '@/lib/ingest/auto';
import { estimateClassifyCost } from '@/lib/llm/classify';
import type { LlmProvider } from '@/lib/llm/models';
import { fmtCost, fmtTokens, dayKey, fmtDay } from '@/lib/format';
import { parseRange, rangeDays, rangeLabel, rangeShortLabel } from '@/lib/range';

export const dynamic = 'force-dynamic';

function pctDelta(cur: number, prev: number): { text: string; positive: boolean | null } {
  if (prev === 0) return { text: cur > 0 ? 'new' : '—', positive: cur > 0 ? true : null };
  const pct = ((cur - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return { text: `${sign}${pct.toFixed(0)}% vs prev`, positive: pct >= 0 };
}

type Metric = 'tokens' | 'sessions' | 'cost' | 'breakdown';
type Scale = 'lin' | 'log';
type ChartMode = 'area' | 'bar';

function parseMetric(raw: string | undefined): Metric {
  if (raw === 'sessions' || raw === 'cost' || raw === 'breakdown') return raw;
  return 'tokens';
}
function parseScale(raw: string | undefined): Scale | null {
  return raw === 'lin' || raw === 'log' ? raw : null;
}
function parseChart(raw: string | undefined): ChartMode {
  return raw === 'bar' ? 'bar' : 'area';
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; metric?: string; scale?: string; chart?: string; project?: string; model?: string }>;
}) {
  const sp = await searchParams;
  const rangeKey = parseRange(sp.range);
  const days = rangeDays(rangeKey);
  const shortLabel = rangeShortLabel(rangeKey);
  const fullLabel = rangeLabel(rangeKey).toLowerCase();
  const metric = parseMetric(sp.metric);
  const scale = parseScale(sp.scale);
  const chart = parseChart(sp.chart);
  const allProjects = getProjects();
  const projectId = sp.project && allProjects.some((p) => p.id === sp.project) ? sp.project : null;
  const modelFamilies = getModelFamilies();
  const modelFamily = sp.model && modelFamilies.some((f) => f.family === sp.model) ? sp.model : null;

  // Kick off a background scan so new sessions land on the *next* render;
  // does NOT block this one. Debounced internally — multiple pages within 10s
  // converge on a single scan.
  triggerBackgroundIngest();

  const overview = getOverview();
  const range = getRangeSummary(days, projectId, modelFamily);
  const daily = getDailySeries(days, projectId, modelFamily);
  const projectBreakdown = getProjectBreakdown(days, 8, modelFamily);
  const categories = getCategoryBreakdown(days, projectId, modelFamily);
  const todaySessions = getTodaySessions(projectId, modelFamily);
  const recent = getRecentSessions(8, projectId, modelFamily);
  const daySummary = getDaySummary(dayKey(Date.now()));
  const tokenBreakdown = getTokenBreakdown(days, projectId, modelFamily);
  const tokenSeries = metric === 'breakdown'
    ? getTokenBreakdownSeries(days, projectId, modelFamily)
    : null;
  // Model breakdown is intentionally not filtered by model — it'd always show
  // one bar. We still respect the day window + project filter so the card
  // reflects "what I'm looking at."
  const modelRows = !modelFamily ? getModelBreakdown(days, projectId) : [];

  // Provider-aware messaging for the Daily Summary card. The summary itself
  // is still always the heuristic (the LLM-summary generator isn't wired to
  // a button yet — see roadmap). What we *can* do honestly is reflect which
  // provider is configured rather than hardcoding "Anthropic".
  const llmProvider = (getSetting('llm_provider') as LlmProvider) || 'anthropic';
  const hasLlmKey = llmProvider === 'anthropic'
    ? Boolean(getSetting('anthropic_api_key'))
    : Boolean(getSetting('openai_api_key'));
  const providerLabel = llmProvider === 'openai' ? 'OpenAI' : 'Anthropic';

  // Surface a "N unclassified · classify" chip in the header when auto is off,
  // the user has a key, and there's actually something to classify. The chip
  // shows the estimated cost so the click never feels surprising.
  // Default-on: chip only appears when the user has explicitly opted out.
  const autoClassify = getSetting('auto_classify') !== 'off';
  const unclassifiedCount = !autoClassify && hasLlmKey ? getUnclassifiedCount() : 0;
  const classifyEstimate = unclassifiedCount > 0
    ? await estimateClassifyCost(unclassifiedCount).catch(() => null)
    : null;

  const empty = overview.sessions === 0;

  if (empty) return <EmptyState />;

  const showDelta = days !== null;
  const tokenDelta = pctDelta(range.tokens, range.tokens_prev);
  const sessionDelta = pctDelta(range.sessions, range.sessions_prev);
  const costDelta = pctDelta(range.cost, range.cost_prev);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={fmtDay(Date.now())}
        titleAdornment={
          <div className="flex items-center gap-2">
            <ProjectFilter projects={allProjects.map((p) => ({ id: p.id, name: p.name }))} current={projectId} />
            <ModelFilter families={modelFamilies} current={modelFamily} />
          </div>
        }
        right={
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <RangePicker current={rangeKey} />
              <span className="w-px h-3.5 bg-surface-3" />
              <FreshnessIndicator lastIngestedAt={lastIngestedAt()} />
              {unclassifiedCount > 0 && classifyEstimate && (
                <>
                  <span className="w-px h-3.5 bg-surface-3" />
                  <ClassifyChip count={unclassifiedCount} estimatedUsd={classifyEstimate.totalUsd} />
                </>
              )}
            </div>
            <ShareButton imageUrl={`/api/share/dashboard?days=${days === null ? 'all' : days}&metric=${metric}${scale ? `&scale=${scale}` : ''}${chart !== 'area' ? `&chart=${chart}` : ''}${projectId ? `&project=${projectId}` : ''}${modelFamily ? `&model=${encodeURIComponent(modelFamily)}` : ''}`} />
          </div>
        }
      />

      <div className="p-7 space-y-7">
        <div className="grid grid-cols-4 gap-4">
          <MetricCard
            label={`Tokens · ${shortLabel}`}
            value={fmtTokens(range.tokens)}
            accent="primary"
            hint={showDelta ? tokenDelta.text : undefined}
          />
          <MetricCard
            label={`Sessions · ${shortLabel}`}
            value={range.sessions.toString()}
            hint={showDelta ? sessionDelta.text : undefined}
          />
          <MetricCard
            label={`Projects · ${shortLabel}`}
            value={range.projects.toString()}
            hint="active"
          />
          <MetricCard
            label={`Est. Cost · ${shortLabel}`}
            value={fmtCost(range.cost)}
            accent="secondary"
            hint={showDelta ? costDelta.text : 'retail token prices'}
          />
        </div>

        <UsageChartCard
          data={daily}
          label={fullLabel}
          metric={metric}
          scale={scale}
          chart={chart}
          breakdown={tokenSeries ?? undefined}
        />

        <CacheHealthStrip summary={tokenBreakdown} />

        <div className="grid grid-cols-3 gap-4">
          <div className="card col-span-2">
            <div className="card-header flex items-center justify-between">
              <span>
                {todaySessions.length > 0 ? 'Today’s Activity' : 'Recent Activity'}
              </span>
              <Link href="/timeline" className="normal-case tracking-normal text-ink-mute hover:text-primary text-[11px]">
                Full timeline →
              </Link>
            </div>
            <div className="p-3 space-y-1">
              {(todaySessions.length > 0 ? todaySessions : recent).slice(0, 8).map((s) => (
                <SessionItem key={s.id} session={s} />
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div className="card h-fit">
              <div className="card-header">Daily Summary</div>
              <div className="p-4 text-body-md text-ink-dim leading-relaxed">
                {daySummary || heuristicSummary(todaySessions)}
              </div>
              {!daySummary && !hasLlmKey && (
                <div className="px-4 pb-4 text-[11px] text-ink-mute">
                  Add an {providerLabel} key in{' '}
                  <Link href="/settings" className="text-primary hover:underline">
                    Settings
                  </Link>{' '}
                  to enable AI-written summaries.
                </div>
              )}
            </div>
            {!modelFamily && modelRows.length > 0 && (
              <ModelBreakdownCard rows={modelRows} label={fullLabel} />
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="card col-span-2">
            <div className="card-header flex items-center justify-between">
              <span>Top Projects · {fullLabel}</span>
              <Link href="/projects" className="normal-case tracking-normal text-ink-mute hover:text-primary text-[11px]">
                See all →
              </Link>
            </div>
            <div className="p-4 space-y-2.5">
              {projectBreakdown.map((p) => {
                const max = Math.max(...projectBreakdown.map((x) => x.tokens), 1);
                const pct = (p.tokens / max) * 100;
                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block group hover:bg-surface-2/40 -mx-2 px-2 py-1.5 rounded"
                  >
                    <div className="flex items-baseline justify-between text-body-sm mb-1">
                      <span className="text-ink group-hover:text-primary transition-colors">{p.name}</span>
                      <span className="font-mono text-ink-mute tabular text-code-sm">
                        {p.sessions} {p.sessions === 1 ? 'session' : 'sessions'} · {fmtTokens(p.tokens)} · {fmtCost(p.cost)}
                      </span>
                    </div>
                    <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                );
              })}
              {projectBreakdown.length === 0 && (
                <div className="text-body-sm text-ink-mute text-center py-4">
                  No project activity in the last 30 days.
                </div>
              )}
            </div>
          </div>

          <div className="card h-fit">
            <div className="card-header">Work Type · {shortLabel}</div>
            <div className="p-4 space-y-2">
              {categories.map((c) => {
                const max = Math.max(...categories.map((x) => x.sessions), 1);
                const pct = (c.sessions / max) * 100;
                return (
                  <div key={c.category} className="space-y-1">
                    <div className="flex items-center justify-between text-body-sm">
                      <CategoryBadge category={c.category} />
                      <span className="font-mono tabular text-ink-mute text-code-sm">{c.sessions}</span>
                    </div>
                    <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {categories.length === 0 && (
                <div className="text-body-sm text-ink-mute text-center py-4">No data yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function heuristicSummary(sessions: ReturnType<typeof getTodaySessions>): string {
  if (sessions.length === 0) return 'No AI coding sessions yet today.';
  const projects = new Set(sessions.map((s) => s.project_name));
  const categories = new Map<string, number>();
  for (const s of sessions) {
    if (s.category) categories.set(s.category, (categories.get(s.category) || 0) + 1);
  }
  const topCats = [...categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c.toLowerCase());
  const top = [...new Map(sessions.map((s) => [s.project_name, s])).values()]
    .sort((a, b) => (b.message_count || 0) - (a.message_count || 0))
    .slice(0, 2)
    .map((s) => s.project_name)
    .join(' and ');
  const catText = topCats.length ? ` Activity skewed toward ${topCats.join(' and ')}.` : '';
  return `You ran ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} across ${projects.size} ${projects.size === 1 ? 'project' : 'projects'}${top ? `, mostly on ${top}` : ''}.${catText}`;
}

function EmptyState() {
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="No AI coding sessions found yet" />
      <div className="p-7">
        <div className="card p-10 text-center">
          <div className="text-headline-md text-ink mb-2">No sessions to show</div>
          <div className="text-body-md text-ink-mute mb-4">
            AgentGraphed looks in <span className="font-mono text-ink">~/.claude/projects</span> and{' '}
            <span className="font-mono text-ink">~/.codex/sessions</span>.
          </div>
          <div className="text-body-sm text-ink-mute">
            Run a session with Claude Code or Codex CLI and come back. AgentGraphed picks them up automatically.
          </div>
        </div>
      </div>
    </div>
  );
}
