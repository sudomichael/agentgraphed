'use server';

import { revalidatePath } from 'next/cache';
import { setSetting } from '@/lib/queries';
import { defaultModel, type LlmProvider } from '@/lib/llm/models';

export async function saveLlmAction(formData: FormData): Promise<void> {
  const provider = ((formData.get('provider') as string) || 'anthropic') as LlmProvider;
  const classifierModel = (formData.get('classifier_model') as string) || defaultModel(provider);
  const summarizerModel = (formData.get('summarizer_model') as string) || classifierModel;
  const anthKey = ((formData.get('anthropic_key') as string) || '').trim();
  const oaiKey = ((formData.get('openai_key') as string) || '').trim();

  setSetting('llm_provider', provider);
  setSetting('classifier_model', classifierModel);
  setSetting('summarizer_model', summarizerModel);
  if (anthKey) setSetting('anthropic_api_key', anthKey);
  if (oaiKey) setSetting('openai_api_key', oaiKey);
  revalidatePath('/settings');
}

export async function clearKeyAction(which: 'anthropic' | 'openai'): Promise<void> {
  if (which === 'anthropic') setSetting('anthropic_api_key', '');
  if (which === 'openai') setSetting('openai_api_key', '');
  revalidatePath('/settings');
}

export async function setAutoClassifyAction(on: boolean): Promise<void> {
  setSetting('auto_classify', on ? 'on' : 'off');
  revalidatePath('/settings');
  revalidatePath('/');
}
