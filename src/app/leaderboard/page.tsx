import { PageHeader } from '@/components/PageHeader';
import { LeaderboardOptIn } from '@/components/LeaderboardOptIn';
import { getRangeSummary, getModelBreakdown, getSetting } from '@/lib/queries';
import { fmtCost, fmtTokens } from '@/lib/format';

export const dynamic = 'force-dynamic';

// What this page is for:
//   - Local: explain the leaderboard concept, show the user *exactly* what
//     would be sent, let them opt in (or out). Once opted in, the page
//     shows last-submission status and links to the public rankings at
//     agentgraphed.com/leaderboard.
//
// Honest framing throughout: local-only by default, leaderboard is opt-in,
// and we show the literal payload that goes over the wire before asking.

export default async function LeaderboardPage() {
  const optedIn = getSetting('leaderboard_opt_in') === 'on';
  const handle = getSetting('leaderboard_handle') || '';
  const lastSubmittedAt = parseInt(getSetting('leaderboard_last_submitted_ms') || '0', 10);

  // Compute the exact payload we would send for the current 7-day window.
  // Same shape will be POSTed by the client when opted in.
  const week = getRangeSummary(7);
  const modelMix = getModelBreakdown(7).reduce<Record<string, number>>((acc, row) => {
    acc[row.model] = (acc[row.model] || 0) + row.tokens;
    return acc;
  }, {});
  const previewPayload = {
    handle: handle || '<your handle>',
    week_iso: weekIsoString(),
    tokens: week.tokens,
    sessions: week.sessions,
    projects: week.projects,
    est_cost_usd: round2(week.cost),
    active_days: week.active_months, // weekly view borrows the column; sub-30d ranges always report 1
    model_mix: Object.fromEntries(
      Object.entries(modelMix).slice(0, 5).map(([m, t]) => [m, t]),
    ),
    schema_version: 1,
  };

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        subtitle="Optional · see how you stack up against other AgentGraphed users"
      />

      <div className="p-7 space-y-6 max-w-3xl">
        {/* Status block */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Status</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              local-first by default
            </span>
          </div>
          <div className="p-5">
            {optedIn ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-secondary text-body-md font-medium">
                      Submitting as <span className="font-mono">{handle || '(no handle set)'}</span>
                    </div>
                    <div className="text-[11px] text-ink-mute mt-1">
                      {lastSubmittedAt
                        ? `Last submission ${new Date(lastSubmittedAt).toLocaleString()}`
                        : 'No submission yet — will run on the next dashboard render.'}
                    </div>
                  </div>
                </div>
                <div className="text-body-sm text-ink-mute leading-relaxed">
                  Public rankings are live at{' '}
                  <a
                    href="https://agentgraphed.com/leaderboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    agentgraphed.com/leaderboard
                  </a>
                  . The submitter posts your weekly stats once every 24 hours; if the last
                  submission timestamp above is recent, your row is up to date.
                </div>
                <LeaderboardOptIn initialOptIn={optedIn} initialHandle={handle} />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-body-md text-ink">
                    Opt in to compare your weekly stats with other AgentGraphed users.
                  </div>
                  <div className="text-body-sm text-ink-mute mt-1">
                    Local-first by default. Nothing leaves your machine until you flip the
                    switch. Even then we only send <em>aggregated</em> stats — no prompts,
                    no project names, no session contents.
                  </div>
                </div>
                <LeaderboardOptIn initialOptIn={optedIn} initialHandle={handle} />
              </div>
            )}
          </div>
        </div>

        {/* What we send */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>What we send</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              this is the literal payload — nothing else
            </span>
          </div>
          <div className="p-5 space-y-3">
            <div className="text-body-sm text-ink-mute">
              Each week we&apos;d post a single JSON object with the fields below.
              <span className="text-ink-dim"> Headline numbers only.</span> No prompts,
              session content, project names, file paths, or cwd. The current payload
              for <span className="font-mono">{previewPayload.week_iso}</span>:
            </div>
            <pre className="bg-canvas border border-surface-3 rounded p-3 text-code-sm font-mono text-ink-dim overflow-x-auto">
{JSON.stringify(previewPayload, null, 2)}
            </pre>
            <div className="text-[11px] text-ink-mute leading-relaxed">
              <span className="text-ink-dim">Identity</span> is just the handle you choose
              (anonymous, no email needed). In a later release we&apos;ll add an optional
              GitHub claim so you can rank under your real handle if you want — but
              anonymous handles will keep working.
            </div>
          </div>
        </div>

        {/* Headline stats preview */}
        <div className="grid grid-cols-4 gap-4">
          <Mini label="Tokens · 7d" value={fmtTokens(week.tokens)} />
          <Mini label="Sessions · 7d" value={week.sessions.toLocaleString()} />
          <Mini label="Projects · 7d" value={week.projects.toString()} />
          <Mini label="Est. Cost · 7d" value={fmtCost(week.cost)} accent="secondary" />
        </div>

        <div className="text-[11px] text-ink-mute leading-relaxed border-t border-surface-2 pt-3">
          The leaderboard endpoint <span className="font-mono">agentgraphed.com/api/leaderboard/submit</span>{' '}
          accepts the payload above once per week. You can opt out any time — submissions stop
          immediately. We have no plans to ever publish anything beyond this aggregate view.
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'secondary' }) {
  return (
    <div className="card">
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-mute mb-1">{label}</div>
        <div className={`text-headline-md font-mono ${accent === 'secondary' ? 'text-secondary' : 'text-ink'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ISO week string: 2026-W23. Stable identifier so a user's weekly submission
// for the same window dedupes on the server side.
function weekIsoString(): string {
  const d = new Date();
  // ISO week: Thursday of current week determines the year.
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${tmp.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
