import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { AnalyticsCharts } from '@/components/AnalyticsCharts';
import { RangePicker } from '@/components/RangePicker';
import { TokenBreakdownDetailCard } from '@/components/TokenBreakdownDetailCard';
import {
  getDailySeries,
  getProviderBreakdown,
  getModelBreakdown,
  getRangeSummary,
  getTokenBreakdown,
} from '@/lib/queries';
import { triggerBackgroundIngest } from '@/lib/ingest/auto';
import { fmtCost, fmtTokens } from '@/lib/format';
import { PRICES_LAST_UPDATED } from '@/lib/pricing';
import { parseRange, rangeDays, rangeLabel, rangeShortLabel } from '@/lib/range';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  triggerBackgroundIngest();
  const sp = await searchParams;
  const rangeKey = parseRange(sp.range);
  const days = rangeDays(rangeKey);
  const shortLabel = rangeShortLabel(rangeKey);
  const fullLabel = rangeLabel(rangeKey).toLowerCase();

  const daily = getDailySeries(days);
  const providers = getProviderBreakdown();
  const models = getModelBreakdown();
  const summary = getRangeSummary(days);
  const tokenBreakdown = getTokenBreakdown(days);

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Quantitative view of your AI development activity"
        right={<RangePicker current={rangeKey} />}
      />

      <div className="p-7 space-y-7">
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label={`Tokens · ${shortLabel}`} value={fmtTokens(summary.tokens)} accent="primary" />
          <MetricCard label={`Sessions · ${shortLabel}`} value={summary.sessions.toLocaleString()} />
          <MetricCard label={`Projects · ${shortLabel}`} value={summary.projects.toString()} />
          <MetricCard
            label={`Est. Cost · ${shortLabel}`}
            value={fmtCost(summary.cost)}
            accent="secondary"
            hint={`retail · prices ${PRICES_LAST_UPDATED}`}
          />
        </div>

        <TokenBreakdownDetailCard summary={tokenBreakdown} rangeLabel={fullLabel} />

        <AnalyticsCharts daily={daily} providers={providers} models={models} label={fullLabel} />
      </div>
    </div>
  );
}
