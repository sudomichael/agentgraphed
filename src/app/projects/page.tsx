import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { getProjects } from '@/lib/queries';
import { triggerBackgroundIngest } from '@/lib/ingest/auto';
import { fmtTokens, fmtCost, fmtRelative } from '@/lib/format';
import { displayPath } from '@/lib/display-path';

export const dynamic = 'force-dynamic';

export default function ProjectsPage() {
  triggerBackgroundIngest();
  const projects = getProjects();
  const totalTokens = projects.reduce((s, p) => s + p.tokens, 0);
  const totalCost = projects.reduce((s, p) => s + p.cost, 0);
  const maxScore = Math.max(1, ...projects.map((p) => p.sessions));

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} projects · ${fmtTokens(totalTokens)} tokens total · ${fmtCost(totalCost)} est`}
      />

      <div className="p-7">
        <div className="card">
          <table className="w-full text-body-md">
            <thead>
              <tr className="text-left text-label-caps text-ink-mute">
                <th className="px-4 py-3 font-semibold">Project</th>
                <th className="px-4 py-3 font-semibold">Last Active</th>
                <th className="px-4 py-3 font-semibold text-right">Sessions</th>
                <th className="px-4 py-3 font-semibold text-right">Tokens</th>
                <th className="px-4 py-3 font-semibold text-right">Est. Cost</th>
                <th className="px-4 py-3 font-semibold">Activity</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => {
                const pct = (p.sessions / maxScore) * 100;
                return (
                  <tr
                    key={p.id}
                    className={`border-t border-surface-2 hover:bg-surface-2/50 transition-colors ${
                      i % 2 === 1 ? 'bg-surface-1/40' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/projects/${p.id}`} className="text-ink hover:text-primary">
                        {p.name}
                      </Link>
                      <div className="font-mono text-code-sm text-ink-mute truncate max-w-[420px]">
                        {displayPath(p.root_path)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-dim font-mono text-code-sm">
                      {fmtRelative(p.last_active)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular">{p.sessions}</td>
                    <td className="px-4 py-3 text-right font-mono tabular">{fmtTokens(p.tokens)}</td>
                    <td className="px-4 py-3 text-right font-mono tabular text-secondary">
                      {fmtCost(p.cost)}
                    </td>
                    <td className="px-4 py-3 min-w-[120px]">
                      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-ink-mute py-10">
                    No projects yet.
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
