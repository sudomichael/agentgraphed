import { PageHeader } from '@/components/PageHeader';
import { SessionItem } from '@/components/SessionItem';
import { getTimeline, getProjects } from '@/lib/queries';
import { triggerBackgroundIngest } from '@/lib/ingest/auto';
import { fmtTokens, fmtCost } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; provider?: string; q?: string }>;
}) {
  triggerBackgroundIngest();
  const sp = await searchParams;
  const projects = getProjects();
  const groups = getTimeline({
    projectId: sp.project,
    provider: sp.provider,
    search: sp.q,
    limit: 200,
  });

  return (
    <div>
      <PageHeader
        title="Timeline"
        subtitle="Chronological record of every AI coding session"
      />

      <form className="px-7 pt-5 pb-3 flex items-center gap-3 border-b border-surface-2" method="get">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="Search prompts…"
          className="bg-surface-1 border border-surface-3 rounded px-3 h-8 text-body-md flex-1 max-w-md focus:outline-none focus:border-primary"
        />
        <select
          name="project"
          defaultValue={sp.project ?? ''}
          className="bg-surface-1 border border-surface-3 rounded px-2 h-8 text-body-sm"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          name="provider"
          defaultValue={sp.provider ?? ''}
          className="bg-surface-1 border border-surface-3 rounded px-2 h-8 text-body-sm"
        >
          <option value="">All providers</option>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
          <option value="opencode">OpenCode</option>
        </select>
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="p-7 space-y-7">
        {groups.length === 0 && (
          <div className="text-body-sm text-ink-mute text-center py-12">No sessions match these filters.</div>
        )}
        {groups.map((g) => {
          // Sessions that closed on this day drive the day total; the entry
          // count includes started/continued/closed roles for visibility.
          const closingCount = g.entries.filter((e) => e.role === 'single' || e.role === 'closed').length;
          return (
            <section key={g.day}>
              <header className="flex items-baseline gap-3 mb-3">
                <h2 className="text-headline-md text-ink">
                  {new Date(g.dayMs).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h2>
                <span className="text-body-sm text-ink-mute font-mono tabular">
                  {closingCount} closed · {g.entries.length} active · {fmtTokens(g.totalTokens)} tok · {fmtCost(g.totalCost)}
                </span>
              </header>
              <div className="card divide-y divide-surface-2">
                <div className="p-3 space-y-1">
                  {g.entries.map((e) => (
                    <SessionItem
                      key={`${e.session.id}-${e.role}`}
                      session={e.session}
                      role={e.role}
                      spanDays={e.spanDays}
                    />
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
