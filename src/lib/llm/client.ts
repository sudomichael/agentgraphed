import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getSetting } from '../queries';
import type { LlmProvider } from './models';
import { defaultModel, findModel } from './models';

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string;
  classifierModel: string;
  summarizerModel: string;
};

export function getLlmConfig(): LlmConfig | null {
  const provider = (getSetting('llm_provider') as LlmProvider) || 'anthropic';
  const keyName = provider === 'openai' ? 'openai_api_key' : 'anthropic_api_key';
  const apiKey = getSetting(keyName) || process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'] || '';
  if (!apiKey) return null;
  const classifierModel = getSetting('classifier_model') || defaultModel(provider);
  const summarizerModel = getSetting('summarizer_model') || defaultModel(provider);
  return { provider, apiKey, classifierModel, summarizerModel };
}

export async function complete(opts: {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const cfg = getLlmConfig();
  if (!cfg) throw new Error('No LLM provider configured');
  const model = findModel(opts.model) ?? findModel(cfg.classifierModel);
  if (!model) throw new Error(`Unknown model: ${opts.model}`);

  if (model.provider === 'anthropic') {
    const c = new Anthropic({ apiKey: cfg.apiKey });
    const res = await c.messages.create({
      model: model.id,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt }],
    });
    const text = res.content.map((b) => ('text' in b ? b.text : '')).join('').trim();
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } else {
    const c = new OpenAI({ apiKey: cfg.apiKey });
    // GPT-5 family is a reasoning model: by default it spends much of its
    // output budget on hidden "reasoning tokens" before emitting a single
    // visible character. For structured classification we don't want that —
    // request `reasoning_effort: 'minimal'` so all output tokens become
    // visible JSON. (Param is ignored by older non-reasoning models.)
    const isReasoning = /^gpt-5/i.test(model.id) || /^o\d/i.test(model.id);
    const res = await c.chat.completions.create({
      model: model.id,
      messages: [
        ...(opts.systemPrompt ? [{ role: 'system' as const, content: opts.systemPrompt }] : []),
        { role: 'user' as const, content: opts.userPrompt },
      ],
      // GPT-5 family rejects the legacy `max_tokens`; older models accept both.
      max_completion_tokens: opts.maxTokens ?? 1024,
      ...(isReasoning ? { reasoning_effort: 'minimal' as const } : {}),
      ...(opts.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
    });
    const text = res.choices[0]?.message?.content?.trim() || '';
    const reasoningTokens = res.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const finishReason = res.choices[0]?.finish_reason;
    // If the model burned all its output budget on reasoning and emitted nothing
    // visible, surface a real error so callers don't silently bill for $0
    // results. This is the actual failure mode that surfaced as "0 sessions
    // for $X" — the request succeeded, you paid, but no JSON came back.
    if (!text) {
      const why =
        finishReason === 'length' && reasoningTokens > 0
          ? `model used all ${reasoningTokens} output tokens on reasoning before producing any visible content; raise the token budget or use a non-reasoning model`
          : `model returned empty content (finish_reason=${finishReason})`;
      throw new Error(why);
    }
    return {
      text,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    };
  }
}
