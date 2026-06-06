'use server';

import { generateSessionContext, getSessionContext } from '@/lib/llm/context';
import { getLlmConfig } from '@/lib/llm/client';

export async function generateContextAction(sessionId: string): Promise<
  | { ok: true; context: string; costUsd: number; cached: boolean }
  | { ok: false; error: string }
> {
  try {
    const cfg = getLlmConfig();
    if (!cfg) return { ok: false, error: 'No API key configured. Add one in Settings.' };
    const cached = await getSessionContext(sessionId);
    if (cached) return { ok: true, context: cached.context, costUsd: 0, cached: true };
    const res = await generateSessionContext(sessionId, false);
    if (!res) return { ok: false, error: 'Could not generate context for this session.' };
    return { ok: true, context: res.context, costUsd: res.costUsd, cached: false };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
