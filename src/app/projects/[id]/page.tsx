import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { SessionItem } from '@/components/SessionItem';
import { getProject, getSessionsForProject } from '@/lib/queries';
import { fmtTokens, fmtCost, fmtRelative } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const sessions = getSessionsForProject(id, 200);

  const modelCounts = new Map<string, number>();
  for (const s of sessions) {
    const k = s.model || 'unknown';
    modelCounts.set(k, (modelCounts.get(k) || 0) + 1);
  }
  const models = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={project.root_path}
        right={
          project.git_remote ? (
            <span className="font-mono text-code-sm text-ink-mute">{project.git_remote}</span>
          ) : null
        }
      />

      <div className="p-7 space-y-7">
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="Sessions" value={project.sessions.toString()} />
          <MetricCard label="Tokens" value={fmtTokens(project.tokens)} />
          <MetricCard label="Est. Cost" value={fmtCost(project.cost)} accent="secondary" />
          <MetricCard label="Last Active" value={fmtRelative(project.last_active)} />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="card col-span-2">
            <div className="card-header">Recent Sessions</div>
            <div className="p-3 space-y-1">
              {sessions.map((s) => (
                <SessionItem key={s.id} session={s} />
              ))}
              {sessions.length === 0 && (
                <div className="text-body-sm text-ink-mute p-4 text-center">No sessions yet.</div>
              )}
            </div>
          </div>
          <div className="card h-fit">
            <div className="card-header">Models Used</div>
            <div className="p-4 space-y-2">
              {models.map(([m, n]) => (
                <div key={m} className="flex justify-between text-body-sm">
                  <span className="font-mono text-code-sm truncate pr-2">{m}</span>
                  <span className="font-mono tabular text-ink">{n}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
