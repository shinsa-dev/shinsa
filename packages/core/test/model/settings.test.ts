import { describe, expect, test } from 'bun:test';
import { createSettings, createState, DEFAULT_SETTINGS, resolveAttentionLimit } from '../../src/index.ts';

describe('settings', () => {
  test('a new state gets its own copy of the defaults', () => {
    const state = createState();
    state.settings.agentModels = { planner: 'haiku' };
    state.settings.maxFixRounds = 3;
    expect(DEFAULT_SETTINGS.agentModels).toEqual({});
    expect(DEFAULT_SETTINGS.maxFixRounds).toBeNull();
    expect(createState().settings).toEqual(DEFAULT_SETTINGS);
  });

  test('the attention limit is at least one', () => {
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: 0 })).toBe(1);
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: undefined })).toBe(1);
    expect(resolveAttentionLimit({ ...createSettings(), attentionLimit: 3 })).toBe(3);
  });
});
