import { describe, expect, test } from 'bun:test';
import {
  AGENT_ROLES,
  createSettings,
  KNOWN_AGENT_MODELS,
  listAgentProviders,
  resolveAgentModel,
  resolveAgentProvider,
  resolveModelFamily,
  resolveModelLabel,
  resolveProviderLabel,
} from '../../src/index.ts';

describe('resolveAgentModel', () => {
  test('a role set in settings wins', () => {
    const settings = { ...createSettings(), agentModels: { reviewer: 'sonnet' } };
    expect(resolveAgentModel(settings, 'reviewer')).toBe('sonnet');
  });

  test('the classifier and the writer keep Sonnet whatever the default is', () => {
    const settings = { ...createSettings(), defaultModel: 'fable' };
    expect(resolveAgentModel(settings, 'classifier')).toBe('sonnet');
    expect(resolveAgentModel(settings, 'writer')).toBe('sonnet');
    expect(resolveAgentModel(settings, 'agent')).toBe('fable');
  });

  test('no role defaults to Haiku, though it stays in the catalog to pick', () => {
    const settings = { ...createSettings(), defaultModel: null };
    expect(AGENT_ROLES.map((role) => resolveAgentModel(settings, role))).not.toContain('haiku');
    expect(KNOWN_AGENT_MODELS.map((model) => model.id)).toContain('haiku');
  });

  test('with no default model each role falls back to its own', () => {
    const settings = { ...createSettings(), defaultModel: null, agentModels: { agent: '' } };
    expect(resolveAgentModel(settings, 'agent')).toBe('opus');
  });
});

describe('resolveAgentProvider', () => {
  test('a role runs on the default provider unless settings move it', () => {
    const settings = { ...createSettings(), agentProviders: { reviewer: 'codex', answerer: '' } };
    expect(resolveAgentProvider(settings, 'reviewer')).toBe('codex');
    expect(resolveAgentProvider(settings, 'answerer')).toBe('claude');
    expect(resolveAgentProvider({ ...createSettings(), agentProviders: undefined }, 'agent')).toBe('claude');
  });
});

describe('resolveAgentModel on another provider', () => {
  test('a role moved to Codex uses Codex’s model for that role, not the Claude default', () => {
    const settings = { ...createSettings(), agentProviders: { agent: 'codex' } };
    expect(resolveAgentModel(settings, 'agent')).toBe('gpt-6-astra');
    expect(resolveAgentModel({ ...settings, agentModels: { agent: 'gpt-5.6-sol' } }, 'agent')).toBe(
      'gpt-5.6-sol'
    );
  });

  test('asking for another provider than the role’s ignores the role’s chosen model', () => {
    const settings = { ...createSettings(), agentModels: { reviewer: 'sonnet' } };
    expect(resolveAgentModel(settings, 'reviewer', 'codex')).toBe('gpt-6-astra');
    expect(resolveAgentModel(settings, 'classifier', 'codex')).toBe('gpt-5.6-luna');
    expect(resolveAgentModel(settings, 'reviewer', 'unknown')).toBe('opus');
  });

  test('with Codex as the default provider the default model counts for its working roles', () => {
    const settings = { ...createSettings(), defaultProvider: 'codex', defaultModel: 'gpt-5.6-terra' };
    expect(resolveAgentModel(settings, 'agent')).toBe('gpt-5.6-terra');
    expect(resolveAgentModel(settings, 'writer')).toBe('gpt-5.6-luna');
    expect(resolveAgentModel(settings, 'agent', 'claude')).toBe('opus');
  });
});

describe('model names', () => {
  test('Codex models read like the Codex picker', () => {
    expect(resolveModelLabel('gpt-6-astra')).toBe('GPT-6-Astra');
    expect(resolveModelLabel('gpt-5.5-codex')).toBe('GPT-5.5-Codex');
  });

  test('providers have a name, and an unknown one shows its id', () => {
    expect(resolveProviderLabel('codex')).toBe('Codex');
    expect(resolveProviderLabel('cursor')).toBe('cursor');
  });

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

describe('listAgentProviders', () => {
  test('lists each provider a working role runs on once, the quick jobs left out', () => {
    expect(listAgentProviders(createSettings())).toEqual(['claude']);
    const mixed = {
      ...createSettings(),
      agentProviders: { reviewer: 'codex', answerer: 'codex', writer: 'gemini' },
    };
    expect(listAgentProviders(mixed)).toEqual(['claude', 'codex']);
    expect(listAgentProviders({ ...createSettings(), defaultProvider: 'codex' })).toEqual(['codex']);
  });
});
