import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { SessionItem } from '@/components/SessionItem';
import { ShareButton } from '@/components/ShareButton';
import { ModelBreakdownCard } from '@/components/ModelBreakdownCard';
import { getProject, getSessionsForProject, getModelBreakdown } from '@/lib/queries';
import { fmtTokens, fmtCost, fmtRelative } from '@/lib/format';
import { displayPath } from '@/lib/display-path';

export const dynamic = 'force-dynamic';

export default async function ProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();
  const sessions = getSessionsForProject(id, 200);
  const modelRows = getModelBreakdown(null, id);

  return (
    <div>
      <PageHeader
        title={project.name}
        subtitle={displayPath(project.root_path)}
        right={
          <div className="flex items-center gap-3">
            {project.git_remote && (
              <span className="font-mono text-code-sm text-ink-mute">{project.git_remote}</span>
            )}
            <ShareButton imageUrl={`/api/share/project/${id}`} />
          </div>
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
          <div className="h-fit">
            <ModelBreakdownCard rows={modelRows} label="all time" />
          </div>
        </div>
      </div>
    </div>
  );
}
