import { notFound } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { MetricCard } from '@/components/MetricCard';
import { CategoryBadge } from '@/components/CategoryBadge';
import { SessionActions } from '@/components/SessionActions';
import { ResumePanel } from '@/components/ResumePanel';
import { ShareButton } from '@/components/ShareButton';
import { TokenBreakdownCard } from '@/components/TokenBreakdownCard';
import { getSession, getSessionMessages, sessionCategories, getSessionModelMix, getSessionTokenBreakdown } from '@/lib/queries';
import { fmtCost, fmtDuration, fmtTokens, fmtClock } from '@/lib/format';
import { displayTitle } from '@/lib/sessionDisplay';
import { displayPath } from '@/lib/display-path';
import { getLlmConfig } from '@/lib/llm/client';
import { getSessionContext } from '@/lib/llm/context';

export const dynamic = 'force-dynamic';

export default async function SessionDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();
  const messages = getSessionMessages(id);
  const modelMix = getSessionModelMix(id);
  const tokenBreakdown = getSessionTokenBreakdown(id);

  const title = displayTitle(session);
  const tokens =
    session.input_tokens + session.output_tokens + session.cache_read_tokens + session.cache_write_tokens;
  const hasLlmKey = getLlmConfig() !== null;
  const cached = await getSessionContext(id);

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            {sessionCategories(session).map((c) => <CategoryBadge key={c} category={c} />)}
            <Link href={`/projects/${session.project_id}`} className="hover:text-primary">
              {session.project_name}
            </Link>
            <span className="text-ink-mute">·</span>
            <span className="font-mono">{session.model || 'unknown model'}</span>
            <span className="text-ink-mute">·</span>
            <span>{new Date(session.started_at).toLocaleString()}</span>
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            <SessionActions
              sessionId={id}
              hasLlmKey={hasLlmKey}
              cachedContext={cached?.context ?? null}
            />
            <ShareButton imageUrl={`/api/share/session/${id}`} />
          </div>
        }
      />

      <div className="p-7 space-y-7">
        <ResumePanel provider={session.provider} cwd={displayPath(session.cwd)} sessionId={id} />

        <div className="grid grid-cols-5 gap-4">
          <MetricCard label="Tokens" value={fmtTokens(tokens)} />
          <MetricCard label="Input" value={fmtTokens(session.input_tokens)} />
          <MetricCard label="Output" value={fmtTokens(session.output_tokens)} />
          <MetricCard label="Cache Read" value={fmtTokens(session.cache_read_tokens)} />
          <MetricCard label="Est. Cost" value={fmtCost(session.est_cost_usd)} accent="secondary" />
        </div>

        <TokenBreakdownCard rows={tokenBreakdown} />

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Conversation</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute">
              {session.user_message_count} user messages · {fmtDuration(session.duration_ms)}
            </span>
          </div>
          <div className="p-5 space-y-3">
            {messages.map((m) => {
              const isUser = m.role === 'user';
              const msgTokens = m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens;
              return (
                <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex flex-col max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
                    <div className="text-[10px] font-mono text-ink-mute mb-1 px-1 flex items-center gap-2">
                      <span className="uppercase tracking-wider">{isUser ? 'you' : 'assistant'}</span>
                      <span>·</span>
                      <span>{fmtClock(m.timestamp)}</span>
                      {msgTokens > 0 && (
                        <>
                          <span>·</span>
                          <span>{fmtTokens(msgTokens)}</span>
                        </>
                      )}
                      {!isUser && m.model && (
                        <>
                          <span>·</span>
                          <span>{m.model}</span>
                        </>
                      )}
                    </div>
                    <div
                      className={`rounded-lg px-4 py-2.5 text-body-md leading-relaxed whitespace-pre-wrap break-words ${
                        isUser
                          ? 'bg-primary/10 border border-primary/30 text-ink rounded-br-sm'
                          : 'bg-surface-2 border border-surface-3 text-ink-dim rounded-bl-sm'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                </div>
              );
            })}
            {messages.length === 0 && (
              <div className="p-6 text-center text-ink-mute text-body-sm">
                No message content captured for this session.
              </div>
            )}
          </div>
        </div>

        {modelMix.length > 0 && (
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span>Models in this session</span>
              <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">assistant messages</span>
            </div>
            <div className="p-4 space-y-2">
              {modelMix.map((m) => {
                const max = Math.max(...modelMix.map((x) => x.messages), 1);
                const pct = (m.messages / max) * 100;
                return (
                  <div key={m.family} className="space-y-1">
                    <div className="flex items-baseline justify-between text-body-sm">
                      <span className="text-ink">{m.family}</span>
                      <span className="font-mono text-ink-mute tabular text-code-sm">
                        {m.messages} {m.messages === 1 ? 'message' : 'messages'}
                      </span>
                    </div>
                    <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">Session Metadata</div>
          <div className="p-4 grid grid-cols-2 gap-3 font-mono text-code-sm">
            <Row k="Session ID" v={session.id} />
            <Row k="Provider" v={session.provider} />
            <Row k="cwd" v={displayPath(session.cwd)} />
            <Row k="git branch" v={session.git_branch || '—'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-ink-mute min-w-[100px]">{k}</span>
      <span className="text-ink-dim break-all">{v}</span>
    </div>
  );
}
