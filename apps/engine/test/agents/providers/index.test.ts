import { describe, expect, test } from 'bun:test';
import { type AgentProvider, ProviderRegistry } from '../../../src/agents/providers/index.ts';

function createProvider(id: string, extra: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id,
    label: id,
    startSession: () => {
      throw new Error('unused');
    },
    listModels: () => Promise.resolve([]),
    complete: () => Promise.resolve(null),
    ...extra,
  };
}

describe('ProviderRegistry', () => {
  test('resolves a provider by id and falls back to Claude for an unknown one', () => {
    const claude = createProvider('claude');
    const codex = createProvider('codex');
    const registry = new ProviderRegistry([codex, claude]);
    expect(registry.list()).toEqual([codex, claude]);
    expect(registry.resolve('codex')).toBe(codex);
    expect(registry.resolve(null)).toBe(claude);
    expect(registry.resolve('nope')).toBe(claude);
  });

  test('falls back to the first provider without Claude, and refuses an empty registry', () => {
    const codex = createProvider('codex');
    expect(new ProviderRegistry([codex]).resolve('nope')).toBe(codex);
    expect(() => new ProviderRegistry([]).resolve('claude')).toThrow('Shinsa has no agent provider.');
    expect(new ProviderRegistry().resolve('claude').id).toBe('claude');
  });

  test('Claude and Codex are registered by default', () => {
    expect(new ProviderRegistry().list().map((provider) => provider.id)).toEqual(['claude', 'codex']);
  });

  test('lists each provider with its models, and the sign-ins of the providers that report one', async () => {
    const claude = createProvider('claude', {
      listModels: () => Promise.resolve([{ id: 'opus', label: 'Opus 5.5', description: '' }]),
    });
    const codex = createProvider('codex', {
      readLogin: () =>
        Promise.resolve({
          provider: 'codex',
          label: 'Codex',
          status: 'signed_out',
          method: null,
          version: null,
          detail: null,
          fix: null,
        }),
    });
    const registry = new ProviderRegistry([claude, codex]);
    expect(await registry.listProviders()).toEqual([
      { id: 'claude', label: 'claude', models: [{ id: 'opus', label: 'Opus 5.5', description: '' }] },
      { id: 'codex', label: 'codex', models: [] },
    ]);
    expect((await registry.listLogins()).map((login) => login.status)).toEqual(['signed_out']);
  });
});
