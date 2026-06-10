import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { LeaderboardOptIn } from '@/components/LeaderboardOptIn';
import { LeaderboardPayloadDisclosure } from '@/components/LeaderboardPayloadDisclosure';
import { getSetting, getSessionsForLeaderboard, getRangeSummary } from '@/lib/queries';
import { fmtCost, fmtTokens } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Page structure (not opted in):
//   1. Hero — sell the leaderboard.
//   2. Your stats — your real numbers + estimated rank pulled live from the server.
//   3. Join CTA — handle input + big button. The main visual moment.
//   4. Leaderboard preview — top 5 from the live endpoint so the user sees the
//      thing they're joining.
//   5. Privacy summary + payload disclosure — collapsed by default. JSON is
//      hidden behind another disclosure inside this section.
//
// Once opted in, the page collapses to a confirmation card (handle, last
// submission, profile link, audit/delete commands) + the opt-out control.

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_RANGE_URL = 'https://agentgraphed.com/api/leaderboard/range';

type RankResp = {
  ok: boolean;
  rows: Array<{ handle: string; tokens: number; sessions: number; est_cost_usd: number; models: Record<string, number> }>;
};

async function fetchPublicTop(window: '7d', metric: 'cost', limit: number): Promise<RankResp['rows']> {
  try {
    const url = `${PUBLIC_RANGE_URL}?window=${window}&metric=${metric}&limit=${limit}`;
    const res = await fetch(url, { next: { revalidate: 120 } });
    if (!res.ok) return [];
    const json = (await res.json()) as RankResp;
    return json.ok ? json.rows : [];
  } catch {
    return [];
  }
}

function estimatedRank(userCost: number, rows: RankResp['rows']): number | null {
  if (rows.length === 0) return null;
  // 1-indexed rank: how many rows have a higher cost, plus one.
  const higher = rows.filter((r) => r.est_cost_usd > userCost).length;
  return higher + 1;
}

export default async function LeaderboardPage() {
  const optedIn = getSetting('leaderboard_opt_in') === 'on';
  const handle = getSetting('leaderboard_handle') || '';
  const lastSubmittedAt = parseInt(getSetting('leaderboard_last_submitted_ms') || '0', 10);
  // Newline-delimited raw URLs. Cleaned/normalized server-side before
  // submit so this setting can hold the raw user-entered form.
  const socialLinksRaw = (getSetting('leaderboard_social_links') ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const week = getRangeSummary(7);
  const sessions = getSessionsForLeaderboard(Date.now() - LOOKBACK_MS);

  // Top 100 for a more honest rank estimate (the leaderboard endpoint
  // returns at most 100 rows). If the user's cost beats everyone in the
  // top 100, we say "top 100"; otherwise we give the actual slot.
  const topRows = await fetchPublicTop('7d', 'cost', 100);
  const userRank = topRows.length > 0 ? estimatedRank(week.cost, topRows) : null;
  const preview = topRows.slice(0, 5);

  // The exact payload that will be sent (used by the collapsed disclosure).
  const previewPayload = {
    handle: handle || '<your-handle>',
    schema_version: 2,
    sessions: sessions.slice(0, 3).map((s) => ({
      session_uuid: s.session_uuid,
      started_at: new Date(s.started_at).toISOString(),
      duration_ms: s.duration_ms,
      provider: s.provider,
      model: s.model,
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      cache_read_tokens: s.cache_read_tokens,
      cache_write_tokens: s.cache_write_tokens,
      est_cost_usd: Math.round(s.est_cost_usd * 10000) / 10000,
      message_count: s.message_count,
    })),
  };
  const previewJson = JSON.stringify(previewPayload, null, 2);

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        subtitle="See how you stack up against other AgentGraphed users"
      />

      <div className="p-7 space-y-7 max-w-3xl">
        {optedIn ? (
          <OptedInState
            handle={handle}
            lastSubmittedAt={lastSubmittedAt}
            week={week}
            userRank={userRank}
            preview={preview}
            previewJson={previewJson}
            socialLinksRaw={socialLinksRaw}
          />
        ) : (
          <NotOptedInState
            handle={handle}
            week={week}
            userRank={userRank}
            preview={preview}
            previewJson={previewJson}
            socialLinksRaw={socialLinksRaw}
          />
        )}
      </div>
    </div>
  );
}

/* ============================================================
   NOT OPTED IN — hero + stats + CTA + preview + privacy
   ============================================================ */

function NotOptedInState({
  handle,
  week,
  userRank,
  preview,
  previewJson,
  socialLinksRaw,
}: {
  handle: string;
  week: { tokens: number; sessions: number; projects: number; cost: number };
  userRank: number | null;
  preview: Array<{ handle: string; tokens: number; sessions: number; est_cost_usd: number }>;
  previewJson: string;
  socialLinksRaw: string[];
}) {
  return (
    <>
      {/* 1. Hero */}
      <div className="space-y-3">
        <h1 className="text-headline-md font-semibold text-ink leading-tight">
          Join the AgentGraphed leaderboard
        </h1>
        <p className="text-body-md text-ink-dim leading-relaxed max-w-2xl">
          Compare your weekly AI coding stats against other power users. Rank by tokens,
          sessions, projects, or cost. Track how your usage shifts week over week with
          a public profile that updates every few hours.
        </p>
        <ul className="text-body-sm text-ink-mute leading-relaxed max-w-2xl list-none space-y-1">
          <li>
            <span className="text-primary">→</span> See where you rank among the top spenders, token burners, and session marathoners.
          </li>
          <li>
            <span className="text-primary">→</span> Public profile page at <span className="font-mono">agentgraphed.com/u/&lt;handle&gt;</span> with your model split and session history.
          </li>
          <li>
            <span className="text-primary">→</span> Anonymous handles — no email, no signup. You can opt out (and delete your data) any time.
          </li>
        </ul>
      </div>

      {/* 2. Your stats */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Your stats this week</span>
          <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
            from your local data · nothing sent yet
          </span>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-4 gap-4">
            <Mini label="Tokens · 7d" value={fmtTokens(week.tokens)} accent="primary" />
            <Mini label="Sessions · 7d" value={week.sessions.toLocaleString()} />
            <Mini label="Projects · 7d" value={week.projects.toString()} />
            <Mini label="Est. Cost · 7d" value={fmtCost(week.cost)} accent="secondary" />
          </div>
          {userRank !== null && week.cost > 0 && (
            <div className="flex items-baseline gap-3 pt-2 border-t border-surface-2">
              <span className="text-[11px] uppercase tracking-wider text-ink-mute">
                Estimated rank by cost
              </span>
              <span className="text-headline-md font-semibold text-secondary tabular">
                #{userRank}
              </span>
              <span className="text-body-sm text-ink-mute">
                in the public top 100 if you joined right now
              </span>
            </div>
          )}
          {userRank === null && week.cost === 0 && (
            <div className="text-body-sm text-ink-mute pt-2 border-t border-surface-2">
              No usage in the last 7 days yet — join now and start ranking as soon as you run a session.
            </div>
          )}
        </div>
      </div>

      {/* 3. Join CTA */}
      <div className="card border-secondary/30 bg-gradient-to-br from-secondary/[0.06] to-transparent">
        <div className="p-6 space-y-4">
          <div>
            <div className="text-headline-md text-ink font-semibold mb-1">
              Pick a handle and join
            </div>
            <div className="text-body-sm text-ink-mute">
              Anonymous · no email needed · opt out any time
            </div>
          </div>
          <LeaderboardOptIn
            initialOptIn={false}
            initialHandle={handle}
            initialSocialLinks={socialLinksRaw}
          />
        </div>
      </div>

      {/* 4. Leaderboard preview */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Top this week (live)</span>
          <a
            href="https://agentgraphed.com/leaderboard"
            target="_blank"
            rel="noreferrer"
            className="normal-case tracking-normal text-[11px] text-ink-mute hover:text-primary"
          >
            See full leaderboard →
          </a>
        </div>
        {preview.length === 0 ? (
          <div className="p-5 text-body-sm text-ink-mute">
            No public submissions yet — you could be rank #1. Join above to claim it.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-2 text-[11px] uppercase tracking-wider text-ink-mute">
                <th className="text-right pr-2 py-2 pl-5 w-12">#</th>
                <th className="text-left py-2">Handle</th>
                <th className="text-right py-2">Est. cost · 7d</th>
                <th className="text-right py-2">Tokens · 7d</th>
                <th className="text-right py-2 pr-5">Sessions · 7d</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => (
                <tr key={r.handle} className="border-b border-surface-2/50 last:border-b-0">
                  <td className="text-right pr-2 pl-5 py-2.5 text-ink-mute font-mono tabular">{i + 1}</td>
                  <td className="py-2.5 font-mono text-ink">
                    <a
                      href={`https://agentgraphed.com/u/${encodeURIComponent(r.handle)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary"
                    >
                      {r.handle}
                    </a>
                  </td>
                  <td className="text-right py-2.5 font-mono tabular text-secondary">{fmtCost(r.est_cost_usd)}</td>
                  <td className="text-right py-2.5 font-mono tabular text-ink-dim">{fmtTokens(r.tokens)}</td>
                  <td className="text-right py-2.5 pr-5 font-mono tabular text-ink-dim">{r.sessions.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 5. Privacy summary (collapsed JSON inside) */}
      <LeaderboardPayloadDisclosure previewJson={previewJson} sessionCount={previewJson === '{}' ? 0 : -1} />
    </>
  );
}

/* ============================================================
   OPTED IN — confirmation + profile + audit/delete + opt-out
   ============================================================ */

function OptedInState({
  handle,
  lastSubmittedAt,
  week,
  userRank,
  preview,
  previewJson,
  socialLinksRaw,
}: {
  handle: string;
  lastSubmittedAt: number;
  week: { tokens: number; sessions: number; projects: number; cost: number };
  userRank: number | null;
  preview: Array<{ handle: string; tokens: number; sessions: number; est_cost_usd: number }>;
  previewJson: string;
  socialLinksRaw: string[];
}) {
  const profileUrl = `https://agentgraphed.com/u/${encodeURIComponent(handle)}`;
  return (
    <>
      {/* Status hero */}
      <div className="card border-secondary/30">
        <div className="p-6 space-y-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-secondary mb-1.5">
              ✓ You&apos;re on the leaderboard
            </div>
            <div className="text-headline-md text-ink font-semibold font-mono">
              {handle || '(no handle set)'}
            </div>
            <div className="text-body-sm text-ink-mute mt-1">
              {lastSubmittedAt
                ? `Last submission ${new Date(lastSubmittedAt).toLocaleString()} · next in ~6 hours (sooner if you finish a new session)`
                : 'No submission yet — will run on the next dashboard render.'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={profileUrl} target="_blank" rel="noreferrer" className="btn btn-primary">
              View your profile ↗
            </a>
            <a
              href="https://agentgraphed.com/leaderboard"
              target="_blank"
              rel="noreferrer"
              className="btn"
            >
              See full rankings ↗
            </a>
          </div>
        </div>
      </div>

      {/* Your current stats */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Your stats this week</span>
          {userRank !== null && week.cost > 0 && (
            <span className="normal-case tracking-normal font-mono text-[11px] text-secondary">
              ≈ rank #{userRank} by cost
            </span>
          )}
        </div>
        <div className="p-5">
          <div className="grid grid-cols-4 gap-4">
            <Mini label="Tokens · 7d" value={fmtTokens(week.tokens)} accent="primary" />
            <Mini label="Sessions · 7d" value={week.sessions.toLocaleString()} />
            <Mini label="Projects · 7d" value={week.projects.toString()} />
            <Mini label="Est. Cost · 7d" value={fmtCost(week.cost)} accent="secondary" />
          </div>
        </div>
      </div>

      {/* Top 5 mini-leaderboard */}
      {preview.length > 0 && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Top this week (live)</span>
            <a
              href="https://agentgraphed.com/leaderboard"
              target="_blank"
              rel="noreferrer"
              className="normal-case tracking-normal text-[11px] text-ink-mute hover:text-primary"
            >
              See full leaderboard →
            </a>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-surface-2 text-[11px] uppercase tracking-wider text-ink-mute">
                <th className="text-right pr-2 py-2 pl-5 w-12">#</th>
                <th className="text-left py-2">Handle</th>
                <th className="text-right py-2">Est. cost · 7d</th>
                <th className="text-right py-2 pr-5">Tokens · 7d</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r, i) => {
                const isMe = r.handle === handle;
                return (
                  <tr
                    key={r.handle}
                    className={`border-b border-surface-2/50 last:border-b-0 ${isMe ? 'bg-secondary/[0.05]' : ''}`}
                  >
                    <td className="text-right pr-2 pl-5 py-2.5 text-ink-mute font-mono tabular">{i + 1}</td>
                    <td className="py-2.5 font-mono">
                      <a
                        href={`https://agentgraphed.com/u/${encodeURIComponent(r.handle)}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`hover:text-primary ${isMe ? 'text-secondary font-semibold' : 'text-ink'}`}
                      >
                        {r.handle}
                        {isMe && <span className="ml-2 text-[10px] uppercase tracking-wider">you</span>}
                      </a>
                    </td>
                    <td className="text-right py-2.5 font-mono tabular text-secondary">{fmtCost(r.est_cost_usd)}</td>
                    <td className="text-right py-2.5 pr-5 font-mono tabular text-ink-dim">{fmtTokens(r.tokens)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit / delete (kept; useful) */}
      {handle && (
        <details className="card">
          <summary className="card-header cursor-pointer flex items-center justify-between list-none">
            <span>Audit or delete your data</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              click to expand
            </span>
          </summary>
          <div className="p-5 space-y-3 text-body-sm text-ink-mute leading-relaxed">
            <p>
              See exactly what the server has for your handle, or delete it. Anyone with your
              handle can do either (it&apos;s anonymous both ways) — by design.
            </p>
            <pre className="bg-canvas border border-surface-3 rounded p-3 text-code-sm font-mono text-ink-dim overflow-x-auto">
{`# See your data
curl 'https://agentgraphed.com/api/leaderboard/my-data?handle=${handle}'

# Delete your data
curl -X DELETE 'https://agentgraphed.com/api/leaderboard/my-data?handle=${handle}'`}
            </pre>
            <p>
              <Link
                href="https://agentgraphed.com/privacy"
                target="_blank"
                className="text-primary hover:underline"
              >
                Full privacy doc →
              </Link>
            </p>
          </div>
        </details>
      )}

      {/* Privacy / payload disclosure — collapsed by default */}
      <LeaderboardPayloadDisclosure previewJson={previewJson} sessionCount={-1} />

      {/* Opt out */}
      <div className="card">
        <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-body-md text-ink">Stop submitting</div>
            <div className="text-body-sm text-ink-mute mt-1">
              Future submissions stop immediately. Your existing data stays until you delete it
              (use the audit command above).
            </div>
          </div>
          <LeaderboardOptIn initialOptIn={true} initialHandle={handle} initialSocialLinks={socialLinksRaw} />
        </div>
      </div>
    </>
  );
}

/* ============================================================
   Shared atoms
   ============================================================ */

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'primary' | 'secondary' }) {
  return (
    <div className="card">
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-mute mb-1">{label}</div>
        <div
          className={`text-headline-md font-mono ${
            accent === 'secondary' ? 'text-secondary' : accent === 'primary' ? 'text-primary' : 'text-ink'
          }`}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
