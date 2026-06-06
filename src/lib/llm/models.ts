// Cheap models suitable for classification + context summaries.
// Prices are USD per 1M tokens, sourced from public list pricing. Used only
// for upfront cost estimates shown to the user.

export type LlmProvider = 'anthropic' | 'openai';

export type ModelInfo = {
  id: string;
  label: string;
  provider: LlmProvider;
  input: number;
  output: number;
};

export const MODELS: ModelInfo[] = [
  // Anthropic
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)', provider: 'anthropic', input: 1, output: 5 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (smarter)', provider: 'anthropic', input: 3, output: 15 },
  // OpenAI
  { id: 'gpt-5-mini', label: 'GPT-5 Mini (cheapest)', provider: 'openai', input: 0.5, output: 2 },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini (very cheap)', provider: 'openai', input: 0.15, output: 0.6 },
  { id: 'gpt-5', label: 'GPT-5 (smarter)', provider: 'openai', input: 2.5, output: 10 },
];

export function modelsForProvider(p: LlmProvider): ModelInfo[] {
  return MODELS.filter((m) => m.provider === p);
}

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function defaultModel(p: LlmProvider): string {
  return p === 'openai' ? 'gpt-5-mini' : 'claude-haiku-4-5';
}

export function estimateLlmCost(model: ModelInfo, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.input + outputTokens * model.output) / 1_000_000;
}
