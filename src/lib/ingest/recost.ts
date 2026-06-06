// Recompute est_cost_usd for every existing session using the current pricing
// table. Useful when prices change (LiteLLM refresh, hardcoded edit) without
// having to wipe + re-ingest from scratch.

import { getSqlite } from '../db/client';
import { estimateCost } from '../pricing';

export function recostAllSessions(): { updated: number } {
  const db = getSqlite();
  const rows = db
    .prepare(
      `SELECT id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
       FROM sessions`,
    )
    .all() as Array<{
      id: string;
      model: string | null;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }>;

  const update = db.prepare('UPDATE sessions SET est_cost_usd = ? WHERE id = ?');
  const tx = db.transaction((rs: typeof rows) => {
    for (const r of rs) {
      const cost = estimateCost({
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
      });
      update.run(cost, r.id);
    }
  });
  tx(rows);
  return { updated: rows.length };
}

if (require.main === module) {
  const r = recostAllSessions();
  console.log(JSON.stringify(r));
}
