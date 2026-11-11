import type { MachineCredentials, RemoteUserId, TaskOwner } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Scope } from 'effect';
import { FetchHttpClient } from 'effect/http';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import { QuickCalls } from '../../src/agents/quick/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { RemoteOrigin } from '../../src/remote/client/schema.ts';
import { RemoteClient } from '../../src/remote/client/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { ScheduleFilter } from '../../src/schedules/filter/service.ts';
import { Slack, SlackStatusInterval } from '../../src/slack/index.ts';
import { createFixedClock } from '../helpers/clock.ts';
import type { Engine } from '../helpers/engine.ts';
import { promised } from '../helpers/promised.ts';

export const OWNER_ACCOUNT = 'gh-owner' as RemoteUserId;

export type Relay = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TestSlackOptions {
  engine: Engine;
  origin: string;
  credentials: MachineCredentials | null;
  fetch?: Relay;
  ask?: QuickJson;
  statusIntervalMs?: number;
  startAt?: number;
  actors?: Record<string, TaskOwner>;
}

export function createTestSlackService(options: TestSlackOptions) {
  const ask: QuickJson = options.ask ?? (() => Effect.succeed(null));
  const fetch = options.fetch ?? (() => Promise.resolve(new Response('', { status: 404 })));
  const client = RemoteClient.layer.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.merge(
        Layer.succeed(RemoteOrigin, options.origin),
        Layer.succeed(
          FetchHttpClient.Fetch,
          Object.assign(fetch, { preconnect: globalThis.fetch.preconnect })
        )
      )
    )
  );
  const layer = Slack.layer({
    credentials: Effect.succeed(options.credentials),
    appOrigin: options.origin,
    resolveActor: (userId) => Effect.succeed(options.actors?.[userId] ?? null),
    isOwner: (userId) => Effect.succeed(userId === OWNER_ACCOUNT),
  }).pipe(
    Layer.provide(ScheduleFilter.layer),
    Layer.provide(
      Layer.mergeAll(
        client,
        Layer.succeed(EngineCore, options.engine.core),
        Layer.succeed(QuickCalls, QuickCalls.of({ classify: ask, write: ask })),
        options.statusIntervalMs === undefined
          ? Layer.empty
          : Layer.succeed(SlackStatusInterval, Duration.millis(options.statusIntervalMs))
      )
    ),
    Layer.provide(JsonLogger)
  );
  return Context.get(Effect.runSync(Layer.buildWithScope(layer, Effect.runSync(Scope.make()))), Slack);
}

export function createTestSlack(options: TestSlackOptions) {
  const service = createTestSlackService(options);
  const clock = { now: options.startAt ?? Date.now() };
  const fixed = createFixedClock(() => clock.now);
  return {
    slack: promised(service, (effect) => Effect.provideService(effect, Clock.Clock, fixed)),
    adjust: (ms: number) => {
      clock.now += ms;
    },
  };
}
