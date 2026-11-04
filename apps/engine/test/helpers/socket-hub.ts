import type { DEVELOPMENT_VERSION } from '@shinsa/core';
import { Effect, Exit, Scope } from 'effect';
import type { Accounts } from '../../src/accounts/roster/service.ts';
import type { Transcripts } from '../../src/agents/transcripts/service.ts';
import { makeSocketHub } from '../../src/http/socket.ts';
import type { ResourceMonitor } from '../../src/resources/index.ts';
import type { Terminals } from '../../src/terminals/service.ts';
import type { CommandRouter } from '../../src/triage/router/service.ts';
import type { Engine } from './engine.ts';

export interface FeedSource<T> {
  subscribe(listener: () => void): () => void;
  snapshot(): T;
}

function toFeed<T>(source: FeedSource<T> | undefined) {
  if (!source) return undefined;
  return {
    observe: (listener: Effect.Effect<void>) =>
      Effect.acquireRelease(
        Effect.sync(() => source.subscribe(() => Effect.runSync(listener))),
        (unsubscribe) => Effect.sync(unsubscribe)
      ).pipe(Effect.asVoid),
    snapshot: Effect.sync(() => source.snapshot()),
  };
}

export function createSocketHub(
  engine: Pick<Engine, 'core'>,
  transcripts: Transcripts['Service'],
  accounts?: Accounts['Service'],
  router: CommandRouter['Service'] | null = null,
  terminals?: Terminals['Service'],
  remote?: FeedSource<Parameters<typeof JSON.stringify>[0]>,
  teamFeeds?: FeedSource<Parameters<typeof JSON.stringify>[0]>,
  version?: typeof DEVELOPMENT_VERSION | string,
  resources?: ResourceMonitor['Service']
) {
  const scope = Effect.runSync(Scope.make());
  const hub = Effect.runSync(
    makeSocketHub({
      engine: engine.core,
      transcripts,
      accounts,
      router,
      terminals,
      remote: toFeed(remote) as never,
      teamFeeds: toFeed(teamFeeds) as never,
      version,
      resources,
    }).pipe(Scope.provide(scope))
  );
  return {
    ...hub,
    stop: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}
