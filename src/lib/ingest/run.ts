import { ingestClaude } from './claude';
import { ingestCodex } from './codex';
import { recostAllSessions } from './recost';
import { getDb, getSqlite } from '../db/client';

export type FullIngestResult = {
  claude: Awaited<ReturnType<typeof ingestClaude>>;
  codex: Awaited<ReturnType<typeof ingestCodex>>;
  durationMs: number;
};

export async function runIngest(opts: { onProgress?: (msg: string) => void } = {}): Promise<FullIngestResult> {
  getDb(); // ensure schema
  const t0 = Date.now();
  const claude = await ingestClaude(opts);
  const codex = await ingestCodex(opts);

  // If pricing data has been refreshed since we last recosted, rerun cost
  // estimation on existing sessions so the dashboard reflects current prices.
  try {
    const db = getSqlite();
    const meta = db
      .prepare("SELECT value FROM settings WHERE key = 'pricing_last_recosted'")
      .get() as { value: string } | undefined;
    const fs = await import('node:fs');
    const path = await import('node:path');
    const pricingMeta = path.join(process.cwd(), 'src/lib/pricing-data/litellm.meta.json');
    if (fs.existsSync(pricingMeta)) {
      const { fetchedAt } = JSON.parse(fs.readFileSync(pricingMeta, 'utf8'));
      if (!meta || meta.value !== fetchedAt) {
        recostAllSessions();
        db.prepare(
          'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ).run('pricing_last_recosted', fetchedAt);
      }
    }
  } catch {
    // recost is a best-effort optimization; ignore failures
  }

  return { claude, codex, durationMs: Date.now() - t0 };
}

if (require.main === module) {
  runIngest({ onProgress: (m) => process.stdout.write(`\r${m.padEnd(60)}`) })
    .then((r) => {
      process.stdout.write('\n');
      console.log(JSON.stringify(r, null, 2));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
