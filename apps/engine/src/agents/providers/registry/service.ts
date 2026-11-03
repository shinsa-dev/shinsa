import { CLAUDE_PROVIDER } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
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
          Effect.map(Effect.promise(provider.listModels), (models) => ({
            id: provider.id,
            label: provider.label,
            models,
          })),
        { concurrency: 'unbounded' }
      ),
      listLogins: Effect.forEach(
        list().flatMap((provider) => (provider.readLogin ? [provider.readLogin] : [])),
        (read) => Effect.promise(read),
        { concurrency: 'unbounded' }
      ),
      listUsageSources: () =>
        list().flatMap((provider): ProviderUsageSource[] => {
          const read = provider.readUsage;
          return read ? [{ id: provider.id, read: () => read() }] : [];
        }),
    };
  };

  static readonly layer = (providers: readonly AgentProvider[]) =>
    Layer.succeed(Providers, Providers.make(providers));
}
