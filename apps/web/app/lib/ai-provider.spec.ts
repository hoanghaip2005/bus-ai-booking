import { describe, expect, it } from 'vitest';

import { defaultOpenAiModel, resolveOpenAiTripSearchConfig } from './ai-provider';

describe('AI provider selection', () => {
  it('uses OpenAI for unprotected trip search when a key is configured', () => {
    expect(
      resolveOpenAiTripSearchConfig(undefined, {
        OPENAI_API_KEY: ' test-key ',
        OPENAI_MODEL: undefined,
      }),
    ).toEqual({ apiKey: 'test-key', modelId: defaultOpenAiModel });
  });

  it('keeps the deterministic provider when the key is missing', () => {
    expect(
      resolveOpenAiTripSearchConfig(undefined, {
        OPENAI_API_KEY: ' ',
        OPENAI_MODEL: 'gpt-5.4',
      }),
    ).toBeUndefined();
  });

  it('keeps protected booking and policy flows off the external model', () => {
    expect(
      resolveOpenAiTripSearchConfig(
        { kind: 'policy', input: { policy: 'checkin' } },
        { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'gpt-5.4' },
      ),
    ).toBeUndefined();
  });

  it('honors an explicit model override', () => {
    expect(
      resolveOpenAiTripSearchConfig(undefined, {
        OPENAI_API_KEY: 'test-key',
        OPENAI_MODEL: 'gpt-5.4',
      }),
    ).toMatchObject({ modelId: 'gpt-5.4' });
  });
});
