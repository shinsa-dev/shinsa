import { CLAUDE_PROVIDER } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { ClaudeProvider } from '../claude/provider/service.ts';
import { CodexProvider } from '../codex/provider/service.ts';
import type { AgentProvider } from '../types.ts';
import { NO_PROVIDER, NoAgentProvider, type ProviderUsageSource, type ProvidersShape } from './schema.ts';

export class Providers extends Context.Service<Providers, ProvidersShape>()(
  'shinsa/engine/agents/Providers'
) {
  static readonly make = (providers: readonly AgentProvider[]): ProvidersShape => {
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const list = () => [...byId.values()];

    const resolve = Effect.fn('Providers.resolve')(function* (id: string | null | undefined) {
      const provider = byId.get(id ?? CLAUDE_PROVIDER);
      if (provider) return provider;
      const fallback = byId.get(CLAUDE_PROVIDER) ?? list()[0];
      if (!fallback) return yield* new NoAgentProvider({ message: NO_PROVIDER });
      yield* Effect.logWarning('[Providers] Unknown provider; using the default').pipe(
        Effect.annotateLogs({ provider: id, fallback: fallback.id })
      );
      return fallback;
    });

    return {
      list,
      select: (id) => byId.get(id) ?? null,
      resolve,
      listProviders: Effect.forEach(
        list(),
        (provider) =>
          Effect.map(provider.listModels, (models) => ({
            id: provider.id,
            label: provider.label,
            models,
          })),
        { concurrency: 'unbounded' }
      ),
      listLogins: Effect.forEach(
        list().flatMap((provider) => (provider.readLogin ? [provider.readLogin] : [])),
        (read) => read,
        { concurrency: 'unbounded' }
      ),
      listUsageSources: () =>
        list().flatMap((provider): ProviderUsageSource[] =>
          provider.readUsage ? [{ id: provider.id, read: provider.readUsage }] : []
        ),
    };
  };

  static readonly layer = Layer.effect(
    Providers,
    Effect.gen(function* () {
      const claude = yield* ClaudeProvider;
      const codex = yield* CodexProvider;
      return Providers.make([claude, codex]);
    })
  );
}
