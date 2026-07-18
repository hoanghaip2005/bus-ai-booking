import type { ProtectedAssistantPlan } from './ai-protected-assistant';

export const defaultOpenAiModel = 'gpt-5.4-mini';

export interface OpenAiTripSearchConfig {
  apiKey: string;
  modelId: string;
}

interface OpenAiEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

export function resolveOpenAiTripSearchConfig(
  protectedPlan: ProtectedAssistantPlan | undefined,
  environment: OpenAiEnvironment = process.env as OpenAiEnvironment,
): OpenAiTripSearchConfig | undefined {
  const apiKey = environment.OPENAI_API_KEY?.trim();
  if (protectedPlan || !apiKey) return undefined;

  return {
    apiKey,
    modelId: environment.OPENAI_MODEL?.trim() || defaultOpenAiModel,
  };
}
