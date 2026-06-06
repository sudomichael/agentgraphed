'use server';

import { revalidatePath } from 'next/cache';
import {
  classifyBatch,
  estimateClassifyCost,
  getAllClassifiableRows,
  getUnclassifiedRows,
} from '@/lib/llm/classify';
import { getLlmConfig } from '@/lib/llm/client';

type Scope = 'uncategorized' | 'all';

function pickRows(scope: Scope) {
  return scope === 'all' ? getAllClassifiableRows() : getUnclassifiedRows();
}

export async function estimateAction(scope: Scope): Promise<
  | { ok: true; totalUsd: number; perSessionUsd: number; modelId: string; modelLabel: string; rowCount: number }
  | { ok: false; error: string }
> {
  try {
    const cfg = getLlmConfig();
    if (!cfg) return { ok: false, error: 'No API key configured.' };
    const rows = pickRows(scope);
    const est = await estimateClassifyCost(rows.length);
    return { ok: true, ...est, rowCount: rows.length };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function classifyAction(scope: Scope): Promise<
  | { ok: true; classified: number; costUsd: number; warning?: string }
  | { ok: false; error: string }
> {
  try {
    const cfg = getLlmConfig();
    if (!cfg) return { ok: false, error: 'No API key configured.' };
    const rows = pickRows(scope);
    if (rows.length === 0) return { ok: true, classified: 0, costUsd: 0 };
    const result = await classifyBatch({ rows });
    revalidatePath('/');
    revalidatePath('/settings');
    revalidatePath('/timeline');
    revalidatePath('/sessions');
    revalidatePath('/projects');

    // If everything failed, treat as an error so the UI shows what went wrong
    // instead of a misleading "Classified 0 sessions" success.
    if (result.classified === 0 && result.firstError) {
      return { ok: false, error: result.firstError };
    }

    const warning = result.batchesFailed > 0
      ? `${result.batchesFailed} batch${result.batchesFailed === 1 ? '' : 'es'} failed: ${result.firstError ?? 'unknown error'}`
      : undefined;

    return { ok: true, classified: result.classified, costUsd: result.costUsd, warning };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
