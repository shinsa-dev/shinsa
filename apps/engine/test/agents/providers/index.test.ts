import { describe, expect, test } from 'bun:test';
import { Effect, Exit } from 'effect';
import {
  type AgentProvider,
  ProviderRegistry,
  Providers,
  type ProviderUsageReading,
} from '../../../src/agents/providers/index.ts';
import { NoAgentProvider } from '../../../src/agents/providers/registry/schema.ts';

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

describe('Providers', () => {
  test('is a service: an empty registry fails with NoAgentProvider, a known id resolves', async () => {
    const codex = createProvider('codex');
    const exit = await Effect.runPromiseExit(
      Providers.use((providers) => providers.resolve('codex')).pipe(Effect.provide(Providers.layer([codex])))
    );
    expect(exit).toEqual(Exit.succeed(codex));
    const empty = await Effect.runPromise(Effect.flip(Providers.make([]).resolve('claude')));
    expect(empty).toBeInstanceOf(NoAgentProvider);
    expect(new ProviderRegistry([codex]).service.select('codex')).toBe(codex);
    expect(new ProviderRegistry([codex]).select('claude')).toBeNull();
  });

  test('lists the usage sources of the providers that read usage', async () => {
    const reading = { read: { windows: [] }, email: null, plan: null } as unknown as ProviderUsageReading;
    const codex = createProvider('codex', { readUsage: () => Promise.resolve(reading) });
    const sources = new ProviderRegistry([createProvider('claude'), codex]).listUsageSources();
    expect(sources.map((source) => source.id)).toEqual(['codex']);
    expect(await sources[0]?.read()).toBe(reading);
  });
});
