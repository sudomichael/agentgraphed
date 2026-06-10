'use server';

import { revalidatePath } from 'next/cache';
import { generateSessionContext, getSessionContext } from '@/lib/llm/context';
import { getLlmConfig } from '@/lib/llm/client';
import { classifyBatch } from '@/lib/llm/classify';
import { getSession } from '@/lib/queries';

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

// Synchronously classify a single session — used by the "Title this session"
// button on the detail page when the user doesn't want to wait for the
// background classifier to come around.
export async function classifySessionAction(sessionId: string): Promise<
  | { ok: true; costUsd: number }
  | { ok: false; error: string }
> {
  try {
    const cfg = getLlmConfig();
    if (!cfg) return { ok: false, error: 'No API key configured. Add one in Settings.' };
    const session = getSession(sessionId);
    if (!session) return { ok: false, error: 'Session not found.' };
    const result = await classifyBatch({
      rows: [{ id: session.id, first_prompt: session.first_prompt ?? '' }],
      batchSize: 1,
    });
    if (result.classified === 0) {
      return { ok: false, error: result.firstError ?? 'Classifier returned nothing for this session.' };
    }
    revalidatePath(`/sessions/${sessionId}`);
    return { ok: true, costUsd: result.costUsd };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
