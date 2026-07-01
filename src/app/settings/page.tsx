import { homedir } from 'node:os';
import { join } from 'node:path';
import { PageHeader } from '@/components/PageHeader';
import { LlmSection } from '@/components/LlmSection';
import { SourceList } from '@/components/SourceList';
import { getSources, parseSourceRows } from '@/lib/ingest/sources';
import { getSetting, setSetting } from '@/lib/queries';
import { PRICES_LAST_UPDATED } from '@/lib/pricing';
import { runIngest } from '@/lib/ingest/run';
import { defaultModel, type LlmProvider } from '@/lib/llm/models';
import { revalidatePath } from 'next/cache';
import { dataDir } from '@/lib/db/paths';
import { getSqlite } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

async function savePaths(formData: FormData) {
  'use server';
  // Clean + re-serialize each list so we never persist junk rows. An empty
  // list is stored as "[]", which makes getSources() fall back to the default
  // directory tagged "default".
  const claude = parseSourceRows((formData.get('claude_sources') as string) || '[]');
  const codex = parseSourceRows((formData.get('codex_sources') as string) || '[]');
  setSetting('claude_sources', JSON.stringify(claude));
  setSetting('codex_sources', JSON.stringify(codex));
  // Clearing the ingest cache forces the next scan to re-read every file and
  // re-stamp source_tag, so renaming a tag or moving a path re-tags existing
  // sessions (otherwise the mtime/size cache would skip unchanged files).
  getSqlite().prepare('DELETE FROM ingest_state').run();
  revalidatePath('/settings');
  revalidatePath('/');
}

async function rescan() {
  'use server';
  await runIngest();
  revalidatePath('/');
  revalidatePath('/settings');
}

export default function SettingsPage() {
  const provider = (getSetting('llm_provider') as LlmProvider) || 'anthropic';
  const anthKey = getSetting('anthropic_api_key') || '';
  const oaiKey = getSetting('openai_api_key') || '';
  const classifierModel = getSetting('classifier_model') || defaultModel(provider);
  const summarizerModel = getSetting('summarizer_model') || defaultModel(provider);
  // Default-on. The setting only stores 'off' when the user explicitly
  // opts out — any other state (unset, 'on', anything else) means auto.
  const autoClassify = getSetting('auto_classify') !== 'off';

  const defaultClaude = join(homedir(), '.claude', 'projects');
  const defaultCodex = join(homedir(), '.codex', 'sessions');
  const claudeSources = getSources('claude');
  const codexSources = getSources('codex');

  const stats = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END) AS classified
       FROM sessions WHERE first_prompt IS NOT NULL`,
    )
    .get() as { total: number; classified: number };

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="p-7 space-y-6 max-w-3xl">
        <LlmSection
          provider={provider}
          anthKey={anthKey}
          oaiKey={oaiKey}
          classifierModel={classifierModel}
          summarizerModel={summarizerModel}
          classified={stats.classified}
          total={stats.total}
          autoClassify={autoClassify}
        />

        <div className="card">
          <div className="card-header">Data sources</div>
          <form action={savePaths} className="p-5 space-y-4 text-body-md text-ink-dim">
            <SourceList
              name="claude_sources"
              label="Claude Code log directories"
              initial={claudeSources}
              placeholder={defaultClaude}
            />
            <SourceList
              name="codex_sources"
              label="Codex CLI log directories"
              initial={codexSources}
              placeholder={defaultCodex}
            />
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" type="submit">Save paths</button>
            </div>
            <p className="text-body-sm text-ink-mute">
              Add one row per log directory. The tag labels each source in the
              timeline and sessions views. Remove all rows to fall back to the
              default directory (shown as placeholder), tagged{' '}
              <span className="font-mono">default</span>. Changes apply after
              the next scan — click &quot;Re-scan logs now&quot; to apply them
              immediately.
            </p>
          </form>
          <div className="px-5 pb-5 border-t border-surface-2 pt-4">
            <form action={rescan}>
              <button className="btn" type="submit">Re-scan logs now</button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Leaderboard</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              opt-in · off by default
            </span>
          </div>
          <div className="p-5 text-body-sm text-ink-dim leading-relaxed">
            Compare your weekly stats with other AgentGraphed users. Nothing leaves your
            machine unless you explicitly opt in — and even then only aggregated stats
            (tokens, sessions, cost, model mix). No prompts, no project names, no
            session content.{' '}
            <a href="/leaderboard" className="text-primary hover:underline">
              See exactly what gets sent →
            </a>
          </div>
        </div>

        <div className="text-[11px] text-ink-mute font-mono space-y-0.5 px-1">
          <div>
            <span className="mr-2">data folder:</span>
            <span className="text-ink-dim">{dataDir()}</span>
          </div>
          <div>
            <span className="mr-2">prices last updated:</span>
            <span className="text-ink-dim">{PRICES_LAST_UPDATED}</span>
            <span className="ml-2">— retail list prices, treat as directional</span>
          </div>
        </div>
      </div>
    </div>
  );
}
