'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Sidebar live-quota widget.
//
// Idle: just a small dot + label ("○ Live quota"). No network on mount.
// On hover (or focus): fires one probe per provider in parallel, shows a
// popover with the results. Results stay cached in-component for 60s so a
// quick re-hover hits memory, not the network.
//
// Cost model: only spends tokens when the user actually looks. Realistically
// 5-20 hovers a day = a few thousandths of a cent.

type ProviderKpi = {
  provider: 'claude' | 'codex';
  ok: boolean;
  observedAt: number;
  planType: string | null;
  primary: { pct: number; resetsAt: number; label: string } | null;
  secondary: { pct: number; resetsAt: number; label: string } | null;
  error?: string;
};

type State = {
  claude: ProviderKpi | null;
  codex: ProviderKpi | null;
  fetchedAt: number;          // 0 = never probed
  loading: boolean;
};

const CACHE_MS = 60_000;

function bindingPct(kpi: ProviderKpi | null): number | null {
  if (!kpi || !kpi.ok) return null;
  const a = kpi.primary?.pct ?? null;
  const b = kpi.secondary?.pct ?? null;
  if (a === null && b === null) return null;
  return Math.max(a ?? 0, b ?? 0);
}

function dotColor(state: State): string {
  if (state.fetchedAt === 0) return 'bg-ink-mute';   // idle (never probed)
  const peak = Math.max(bindingPct(state.claude) ?? 0, bindingPct(state.codex) ?? 0);
  if (peak >= 95) return 'bg-error';
  if (peak >= 80) return 'bg-secondary';             // close to limit
  return 'bg-primary';                                // healthy
}

function fmtRelative(ts: number): string {
  const ms = ts - Date.now();
  // OpenAI's per-minute window resets continuously — by the time we render,
  // the reset header has often already elapsed. "resetting" reads as an
  // error state, but it just means the window is rolling. Treat anything
  // within the past 2 minutes as effectively "<1m".
  if (ms <= 0 && ms > -120_000) return '<1m';
  if (ms <= 0) return 'resetting';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function headlineLabel(state: State): string {
  if (state.fetchedAt === 0) return 'Live quota';
  const c = bindingPct(state.claude);
  if (c !== null && state.claude?.primary) {
    return `Claude ${Math.round(c)}% · ${fmtRelative(state.claude.primary.resetsAt)}`;
  }
  return 'Live quota';
}

export function SidebarQuotaWidget() {
  const [state, setState] = useState<State>({ claude: null, codex: null, fetchedAt: 0, loading: false });
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recompute popover position whenever it opens (and on scroll/resize while
  // open). Portaled to <body>, so we must position by absolute pixel coords.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const update = () => {
      if (triggerRef.current) setAnchorRect(triggerRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  const fetchBoth = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const [claudeResp, codexResp] = await Promise.all([
      fetch('/api/quota-probe?provider=claude', { method: 'POST' }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message })),
      fetch('/api/quota-probe?provider=codex',  { method: 'POST' }).then((r) => r.json()).catch((e) => ({ ok: false, error: e.message })),
    ]);
    setState({
      claude: parseProbeResponse('claude', claudeResp),
      codex:  parseProbeResponse('codex',  codexResp),
      fetchedAt: Date.now(),
      loading: false,
    });
  }, []);

  function onEnter() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setOpen(true);
    // Refresh if cache is stale (or never fetched).
    if (Date.now() - state.fetchedAt > CACHE_MS && !state.loading) {
      fetchBoth();
    }
  }

  function onLeave() {
    // Small delay so the cursor can travel into the popover without closing.
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <div
      ref={triggerRef}
      className="relative px-3 py-2 border-b border-surface-2"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
    >
      <button
        type="button"
        onClick={fetchBoth}
        className="w-full flex items-center gap-2 text-[12px] text-ink-dim hover:text-ink"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor(state)} ${state.loading ? 'animate-pulse' : ''}`} />
        <span className="font-mono tabular truncate">
          {state.loading && state.fetchedAt === 0 ? 'Probing…' : headlineLabel(state)}
        </span>
      </button>

      {open && anchorRect && typeof document !== 'undefined' && createPortal(
        <Popover
          state={state}
          loading={state.loading}
          anchorRect={anchorRect}
          onEnter={onEnter}
          onLeave={onLeave}
        />,
        document.body,
      )}
    </div>
  );
}

function Popover({
  state,
  loading,
  anchorRect,
  onEnter,
  onLeave,
}: {
  state: State;
  loading: boolean;
  anchorRect: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  // Position to the right of the trigger with an 8px gap; align tops.
  const popoverStyle: React.CSSProperties = {
    position: 'fixed',
    left: anchorRect.right + 8,
    top: anchorRect.top,
    backgroundColor: '#1c2026',
    isolation: 'isolate', // create our own stacking context, opaque to filters
  };
  return (
    <div
      role="dialog"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // Portaled to <body> so the recharts SVG filter (which lives in its own
      // stacking context) can never paint above us. Opaque background pinned
      // inline; `isolation: isolate` keeps any descendant compositing local.
      className="w-72 z-[9999] rounded-lg border border-surface-3 p-4 space-y-4 shadow-[0_20px_60px_-10px_rgba(0,0,0,0.8)]"
      style={popoverStyle}
    >
      {loading && state.fetchedAt === 0 ? (
        <div className="text-body-sm text-ink-mute">Probing Anthropic & OpenAI…</div>
      ) : (
        <>
          <ProviderBlock kpi={state.claude} />
          <div className="border-t border-surface-2" />
          <ProviderBlock kpi={state.codex} />
          <div className="text-[10px] text-ink-mute font-mono tabular pt-1 border-t border-surface-2">
            {state.fetchedAt === 0
              ? 'never probed'
              : `updated ${fmtSince(state.fetchedAt)} · hover again after 60s to refresh`}
          </div>
        </>
      )}
    </div>
  );
}

function ProviderBlock({ kpi }: { kpi: ProviderKpi | null }) {
  if (!kpi) {
    return <div className="text-body-sm text-ink-mute">No data.</div>;
  }
  const label = kpi.provider === 'claude' ? 'Claude' : 'Codex';
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-label-caps text-ink-dim">{label}</span>
        {kpi.ok && kpi.planType && (
          <span className="text-[10px] text-ink-mute font-mono uppercase tracking-wide">{kpi.planType}</span>
        )}
      </div>
      {kpi.ok ? (
        <>
          {kpi.primary && (
            <PopoverRow label={kpi.primary.label} pct={kpi.primary.pct} resetsAt={kpi.primary.resetsAt} accent="primary" />
          )}
          {kpi.secondary && (
            <PopoverRow label={kpi.secondary.label} pct={kpi.secondary.pct} resetsAt={kpi.secondary.resetsAt} accent="secondary" />
          )}
          {!kpi.primary && !kpi.secondary && (
            <div className="text-body-sm text-ink-mute">No rate-limit headers returned.</div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-ink-mute leading-relaxed">{kpi.error}</div>
      )}
    </div>
  );
}

function PopoverRow({
  label, pct, resetsAt, accent,
}: { label: string; pct: number; resetsAt: number; accent: 'primary' | 'secondary' }) {
  const color = accent === 'primary' ? 'bg-primary' : 'bg-secondary';
  return (
    <div>
      <div className="flex items-baseline justify-between text-body-sm">
        <span className="text-ink font-mono uppercase tracking-wider text-[10px]">{label}</span>
        <span className="font-mono tabular text-ink">{Math.round(pct)}%</span>
      </div>
      <div className="h-1 bg-surface-2 rounded-full overflow-hidden mt-1">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="text-[10px] text-ink-mute font-mono tabular mt-0.5">
        resets in {fmtRelative(resetsAt)}
      </div>
    </div>
  );
}

// --- helpers ---

type ProbeResponseShape =
  | {
      ok: true;
      provider: string;
      snapshot: {
        observedAt: number;
        planType: string | null;
        primary: { pct: number; resetsAt: number; status: string | null } | null;
        secondary: { pct: number; resetsAt: number; status: string | null } | null;
      };
    }
  | { ok: false; error: string };

function parseProbeResponse(provider: 'claude' | 'codex', body: ProbeResponseShape): ProviderKpi {
  if (!body || !('ok' in body)) {
    return { provider, ok: false, observedAt: Date.now(), planType: null, primary: null, secondary: null, error: 'unexpected response' };
  }
  if (!body.ok) {
    return { provider, ok: false, observedAt: Date.now(), planType: null, primary: null, secondary: null, error: body.error };
  }
  const s = body.snapshot;
  return {
    provider,
    ok: true,
    observedAt: s.observedAt,
    planType: s.planType,
    primary: s.primary ? { pct: s.primary.pct, resetsAt: s.primary.resetsAt, label: provider === 'claude' ? '5h' : '1m' } : null,
    secondary: s.secondary ? { pct: s.secondary.pct, resetsAt: s.secondary.resetsAt, label: '7d' } : null,
  };
}

function fmtSince(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}
