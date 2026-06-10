import { PageHeader } from '@/components/PageHeader';
import { SessionRow } from '@/components/SessionRow';
import { getAllSessions, getProjects } from '@/lib/queries';
import { triggerBackgroundIngest } from '@/lib/ingest/auto';

export const dynamic = 'force-dynamic';

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; project?: string }>;
}) {
  triggerBackgroundIngest();
  const sp = await searchParams;
  const sessions = getAllSessions({ provider: sp.provider, projectId: sp.project, limit: 500 });
  const projects = getProjects();

  return (
    <div>
      <PageHeader title="Sessions" subtitle={`${sessions.length} sessions (most recent first)`} />

      <form className="px-7 pt-5 pb-3 flex items-center gap-3 border-b border-surface-2" method="get">
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
        <button className="btn" type="submit">
          Filter
        </button>
      </form>

      <div className="p-7">
        <div className="card overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="text-left text-label-caps text-ink-mute">
                <th className="px-3 py-2 font-semibold">Started</th>
                <th className="px-3 py-2 font-semibold">Provider</th>
                <th className="px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Model</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold text-right">Tokens</th>
                <th className="px-3 py-2 font-semibold text-right">Cost</th>
                <th className="px-3 py-2 font-semibold text-right">Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s, i) => (
                <SessionRow key={s.id} session={s} zebra={i % 2 === 1} />
              ))}
              {sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-ink-mute py-10">
                    No sessions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
