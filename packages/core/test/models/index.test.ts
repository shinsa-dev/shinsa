import { describe, expect, test } from 'bun:test';
import {
  createSettings,
  DEFAULT_AGENT_MODELS,
  resolveAgentModel,
  resolveModelFamily,
  resolveModelLabel,
} from '../../src/index.ts';

describe('resolveAgentModel', () => {
  test('a role set in settings wins', () => {
    const settings = { ...createSettings(), agentModels: { reviewer: 'sonnet' } };
    expect(resolveAgentModel(settings, 'reviewer')).toBe('sonnet');
  });

  test('the classifier and the writer keep their small model whatever the default is', () => {
    const settings = { ...createSettings(), defaultModel: 'fable' };
    expect(resolveAgentModel(settings, 'classifier')).toBe(DEFAULT_AGENT_MODELS.classifier);
    expect(resolveAgentModel(settings, 'writer')).toBe(DEFAULT_AGENT_MODELS.writer);
    expect(resolveAgentModel(settings, 'builder')).toBe('fable');
  });

  test('with no default model each role falls back to its own', () => {
    const settings = { ...createSettings(), defaultModel: null, agentModels: { planner: '' } };
    expect(resolveAgentModel(settings, 'planner')).toBe(DEFAULT_AGENT_MODELS.planner);
  });
});

describe('model names', () => {
  test('known aliases use their catalog label', () => {
    expect(resolveModelLabel('opus')).toBe('Opus 5.5');
  });

  test('full ids read as family and version, with dates and context suffixes dropped', () => {
    expect(resolveModelLabel('claude-opus-4-5-20251101')).toBe('Opus 4.5');
    expect(resolveModelLabel('claude-sonnet-4')).toBe('Sonnet 4');
    expect(resolveModelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5');
    expect(resolveModelLabel('claude-haiku')).toBe('Haiku');
    expect(resolveModelLabel('gpt')).toBe('Gpt');
  });

  test('the family is the word after claude-, or the id itself', () => {
    expect(resolveModelFamily('claude-sonnet-4-5[1m]')).toBe('sonnet');
    expect(resolveModelFamily('opus')).toBe('opus');
  });
});
