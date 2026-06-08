'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Provider = 'claude' | 'codex';

type Snapshot = {
  observedAt: number;
  planType: string | null;
  primary: { pct: number; resetsAt: number; status: string | null } | null;
  secondary: { pct: number; resetsAt: number; status: string | null } | null;
  tokenWasRefreshed: boolean;
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; snap: Snapshot }
  | { kind: 'err'; error: string };

const PROVIDER_KEY = 'agentgraphed.quota.provider';
const HIDDEN_KEY = 'agentgraphed.quota.hidden';

function fmtRelative(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function LiveQuotaCard() {
  const [provider, setProvider] = useState<Provider>('claude');
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const inFlight = useRef(false);

  // Restore persisted preferences.
  useEffect(() => {
    try {
      const p = window.localStorage.getItem(PROVIDER_KEY);
      if (p === 'claude' || p === 'codex') setProvider(p);
      if (window.localStorage.getItem(HIDDEN_KEY) === 'true') setHidden(true);
    } catch { /* ignore */ }
  }, []);

  const probe = useCallback(async (p: Provider) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'loading' });
    try {
      const resp = await fetch(`/api/quota-probe?provider=${p}`, { method: 'POST' });
      const body = (await resp.json()) as
        | { ok: true; snapshot: Snapshot }
        | { ok: false; error: string };
      if (body.ok) setState({ kind: 'ok', snap: body.snapshot });
      else setState({ kind: 'err', error: body.error });
    } catch (e) {
      setState({ kind: 'err', error: (e as Error).message });
    } finally {
      inFlight.current = false;
    }
  }, []);

  function selectProvider(p: Provider) {
    setProvider(p);
    setState({ kind: 'idle' }); // clear stale snapshot when switching
    try { window.localStorage.setItem(PROVIDER_KEY, p); } catch { /* ignore */ }
  }

  function hide() {
    setHidden(true);
    try { window.localStorage.setItem(HIDDEN_KEY, 'true'); } catch { /* ignore */ }
  }

  // Hidden state: render only a tiny inline "Show quota" link the user can click
  // to bring the strip back.
  if (hidden) {
    return (
      <button
        onClick={() => {
          setHidden(false);
          try { window.localStorage.setItem(HIDDEN_KEY, 'false'); } catch { /* ignore */ }
        }}
        className="text-[11px] text-ink-mute hover:text-primary font-mono"
      >
        + show live quota
      </button>
    );
  }

  const snap = state.kind === 'ok' ? state.snap : null;
  const err = state.kind === 'err' ? state.error : null;
  const isLoading = state.kind === 'loading';

  return (
    <div className="card flex items-stretch overflow-hidden">
      <ProviderTabs provider={provider} onSelect={selectProvider} />

      <div className="flex-1 flex items-center gap-4 px-4 py-2.5 min-w-0">
        {snap ? (
          <>
            <Pill
              label={provider === 'claude' ? '5h' : '1m'}
              snap={snap.primary}
              accent="primary"
            />
            {snap.secondary !== null && (
              <Pill label="7d" snap={snap.secondary} accent="secondary" />
            )}
            <div className="text-[11px] text-ink-mute font-mono tabular ml-auto">
              {snap.planType && <span className="mr-3">plan: {snap.planType}</span>}
              <span>updated {fmtSince(snap.observedAt)} ago</span>
            </div>
          </>
        ) : err ? (
          <div className="text-body-sm text-ink-dim flex-1 min-w-0">
            <span className="text-error">Probe failed:</span>{' '}
            <span className="text-ink-mute">{err}</span>
          </div>
        ) : isLoading ? (
          <div className="text-body-sm text-ink-mute">Probing {provider}…</div>
        ) : (
          <div className="text-body-sm text-ink-mute">
            Live quota{' '}
            <span className="text-[11px]">
              ({provider === 'claude' ? '~$0.00006/probe' : 'requires OpenAI key'})
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 pr-2">
        <button
          onClick={() => probe(provider)}
          disabled={isLoading}
          className="text-[11px] font-mono uppercase tracking-wide px-2 py-1 text-ink-mute hover:text-primary disabled:opacity-50"
        >
          {isLoading ? '…' : snap ? 'refresh' : 'probe'}
        </button>
        <button
          onClick={hide}
          className="text-[14px] leading-none px-2 py-1 text-ink-mute hover:text-ink"
          aria-label="Hide live quota"
          title="Hide"
        >
          ×
        </button>
      </div>
    </div>
  );
}

function ProviderTabs({ provider, onSelect }: { provider: Provider; onSelect: (p: Provider) => void }) {
  return (
    <div className="flex flex-col border-r border-surface-2 bg-surface-0/40">
      {(['claude', 'codex'] as const).map((p) => (
        <button
          key={p}
          onClick={() => onSelect(p)}
          className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1 transition-colors flex-1 ${
            provider === p ? 'text-primary bg-surface-1' : 'text-ink-mute hover:text-ink'
          }`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function Pill({
  label,
  snap,
  accent,
}: {
  label: string;
  snap: { pct: number; resetsAt: number; status: string | null } | null;
  accent: 'primary' | 'secondary';
}) {
  if (!snap) {
    return (
      <div className="flex items-center gap-2 text-body-sm text-ink-mute">
        <span className="text-label-caps">{label}</span>
        <span className="font-mono text-code-sm">—</span>
      </div>
    );
  }
  const pct = Math.round(snap.pct);
  const accentClass = accent === 'primary' ? 'bg-primary' : 'bg-secondary';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-label-caps text-ink-mute">{label}</span>
      <div className="w-24 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full ${accentClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="font-mono text-code-sm tabular text-ink whitespace-nowrap">
        {pct}%
      </span>
      <span className="font-mono text-code-sm text-ink-mute whitespace-nowrap">
        · resets {fmtRelative(snap.resetsAt)}
      </span>
    </div>
  );
}

function fmtSince(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
