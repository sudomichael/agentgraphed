import { homedir } from 'node:os';
import { join } from 'node:path';
import { PageHeader } from '@/components/PageHeader';
import { LlmSection } from '@/components/LlmSection';
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
  const claude = ((formData.get('claude_log_dir') as string) || '').trim();
  const codex = ((formData.get('codex_log_dir') as string) || '').trim();
  setSetting('claude_log_dir', claude);
  setSetting('codex_log_dir', codex);
  revalidatePath('/settings');
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
  const claudeLogDir = getSetting('claude_log_dir') || '';
  const codexLogDir = getSetting('codex_log_dir') || '';

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
            <div className="space-y-1">
              <label className="text-label-caps text-ink-mute block">Claude Code log directory</label>
              <input
                name="claude_log_dir"
                defaultValue={claudeLogDir}
                placeholder={defaultClaude}
                className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono w-full focus:outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-label-caps text-ink-mute block">Codex CLI log directory</label>
              <input
                name="codex_log_dir"
                defaultValue={codexLogDir}
                placeholder={defaultCodex}
                className="bg-surface-1 border border-surface-3 rounded px-3 h-9 text-body-md font-mono w-full focus:outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" type="submit">Save paths</button>
            </div>
            <p className="text-body-sm text-ink-mute">
              Leave blank to use defaults shown as placeholders.
            </p>
          </form>
          <div className="px-5 pb-5 border-t border-surface-2 pt-4">
            <form action={rescan}>
              <button className="btn" type="submit">Re-scan logs now</button>
            </form>
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
