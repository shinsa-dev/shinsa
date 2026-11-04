import { describe, expect, test } from 'bun:test';
import { createSettings, resolveCompaction } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { CLAUDE_CAPABILITIES } from '../../../src/agents/providers/claude/index.ts';
import {
  type AgentProvider,
  Providers,
  ProvidersLayer,
  type ProviderUsageReading,
  resolveCapabilities,
  resolveSessionOptions,
} from '../../../src/agents/providers/index.ts';
import { NoAgentProvider } from '../../../src/agents/providers/registry/schema.ts';
import { ShellLayer } from '../../../src/shell/layers.ts';

function createProvider(id: string, extra: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id,
    label: id,
    startSession: () => Effect.die(new Error('unused')),
    listModels: Effect.succeed([]),
    complete: () => Effect.succeed(null),
    ...extra,
  };
}

describe('Providers', () => {
  test('resolves a provider by id and falls back to Claude for an unknown one', async () => {
    const claude = createProvider('claude');
    const codex = createProvider('codex');
    const registry = Providers.make([codex, claude]);
    expect(registry.list()).toEqual([codex, claude]);
    expect(await Effect.runPromise(registry.resolve('codex'))).toBe(codex);
    expect(await Effect.runPromise(registry.resolve(null))).toBe(claude);
    expect(await Effect.runPromise(registry.resolve('nope'))).toBe(claude);
  });

  test('falls back to the first provider without Claude, and an empty registry fails with NoAgentProvider', async () => {
    const codex = createProvider('codex');
    expect(await Effect.runPromise(Providers.make([codex]).resolve('nope'))).toBe(codex);
    const empty = await Effect.runPromise(Effect.flip(Providers.make([]).resolve('claude')));
    expect(empty).toBeInstanceOf(NoAgentProvider);
    expect(empty.message).toBe('Shinsa has no agent provider.');
  });

  test('its layer registers Claude and Codex', async () => {
    const ids = await Effect.runPromise(
      Providers.use((providers) => Effect.succeed(providers.list().map((provider) => provider.id))).pipe(
        Effect.provide(ProvidersLayer.pipe(Layer.provide(ShellLayer)))
      )
    );
    expect(ids).toEqual(['claude', 'codex']);
  });

  test('lists each provider with its models, and the sign-ins of the providers that report one', async () => {
    const claude = createProvider('claude', {
      listModels: Effect.succeed([{ id: 'opus', label: 'Opus 5.5', description: '' }]),
    });
    const codex = createProvider('codex', {
      readLogin: Effect.succeed({
        provider: 'codex',
        label: 'Codex',
        status: 'signed_out',
        method: null,
        version: null,
        detail: null,
        fix: null,
      }),
    });
    const registry = Providers.make([claude, codex]);
    expect(await Effect.runPromise(registry.listProviders)).toEqual([
      { id: 'claude', label: 'claude', models: [{ id: 'opus', label: 'Opus 5.5', description: '' }] },
      { id: 'codex', label: 'codex', models: [] },
    ]);
    expect((await Effect.runPromise(registry.listLogins)).map((login) => login.status)).toEqual([
      'signed_out',
    ]);
    expect(registry.select('codex')).toBe(codex);
    expect(registry.select('gemini')).toBeNull();
  });

  test('lists the usage sources of the providers that read usage', async () => {
    const reading = { read: { windows: [] }, email: null, plan: null } as unknown as ProviderUsageReading;
    const codex = createProvider('codex', { readUsage: Effect.succeed(reading) });
    const sources = Providers.make([createProvider('claude'), codex]).listUsageSources();
    expect(sources.map((source) => source.id)).toEqual(['codex']);
    expect(await Effect.runPromise(sources[0]!.read)).toBe(reading);
  });

  test('session options follow the settings, and fast mode only where the provider can run it', () => {
    const settings = { ...createSettings(), fastMode: true };
    const fast = createProvider('claude', { capabilities: CLAUDE_CAPABILITIES });
    expect(resolveSessionOptions(settings, fast)).toEqual({
      compaction: resolveCompaction(settings),
      fastMode: true,
    });
    expect(resolveSessionOptions(settings, createProvider('plain')).fastMode).toBe(false);
    expect(resolveSessionOptions(createSettings(), fast, 'reviewer').fastMode).toBe(false);
    expect(resolveCapabilities(createProvider('plain')).structuredOutput).toBe(false);
  });
});
