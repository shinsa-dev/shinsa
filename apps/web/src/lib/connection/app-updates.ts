import type { AppUpdateChannel, AppUpdateRequest, AppUpdatesAnswer } from '@shinsa/core/engine-api/schema';
import { toast } from '@shinsa/ui/components/sonner';
import { Effect, Schedule } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import type { AppServices } from '@/lib/runtime/schema.ts';
import { createSignal } from '@/lib/signal.ts';
import { APP_UPDATES_POLL } from './schema.ts';

export type AppUpdatesAction = AppUpdateRequest['kind'] | 'open' | 'restart';

export interface AppUpdatesView {
  answer: AppUpdatesAnswer | null;
  failure: string | null;
  busy: AppUpdatesAction | null;
}

export interface AppUpdatesActions {
  check: () => Promise<void>;
  install: () => Promise<void>;
  changeChannel: (channel: AppUpdateChannel) => Promise<void>;
  answerDowngrade: (accept: boolean) => Promise<void>;
  open: () => Promise<void>;
  restartEngine: () => Promise<void>;
}

type EngineEffect<A> = Effect.Effect<A, Error, EngineClient>;

const LOCAL_ENGINE = '';

const EMPTY: AppUpdatesView = { answer: null, failure: null, busy: null };

const signal = createSignal();

let views: ReadonlyMap<string, AppUpdatesView> = new Map();

function resolveKey(machineId: string | null) {
  return machineId ?? LOCAL_ENGINE;
}

function publish(machineId: string | null, patch: Partial<AppUpdatesView>) {
  const key = resolveKey(machineId);
  views = new Map(views).set(key, { ...(views.get(key) ?? EMPTY), ...patch });
  signal.publish();
}

function onMachine<A>(
  machineId: string | null,
  effect: EngineEffect<A>
): Effect.Effect<A, Error, AppServices> {
  return machineId ? effect.pipe(Effect.provide(EngineClient.onMachine(machineId))) : effect;
}

const read = (machineId: string | null) =>
  onMachine(
    machineId,
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      return yield* engine.appUpdates.view();
    })
  ).pipe(
    Effect.tap((answer) => Effect.sync(() => publish(machineId, { answer, failure: null }))),
    Effect.catch((error) => Effect.sync(() => publish(machineId, { failure: error.message }))),
    Effect.withSpan('AppUpdates.read')
  );

const act = Effect.fn('AppUpdates.act')(function* (
  machineId: string | null,
  action: AppUpdatesAction,
  call: EngineEffect<AppUpdatesAnswer | null>
) {
  publish(machineId, { busy: action });
  yield* onMachine(machineId, call).pipe(
    Effect.tap((answer) => (answer ? Effect.sync(() => publish(machineId, { answer })) : read(machineId))),
    Effect.catch((error) => Effect.sync(() => toast.error(error.message))),
    Effect.ensuring(Effect.sync(() => publish(machineId, { busy: null })))
  );
});

function run(
  machineId: string | null,
  action: AppUpdatesAction,
  call: EngineEffect<AppUpdatesAnswer | null>
) {
  if (selectAppUpdates(machineId).busy !== null) return Promise.resolve();
  return runApp(act(machineId, action, call));
}

function request(machineId: string | null, asked: AppUpdateRequest) {
  return run(
    machineId,
    asked.kind,
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      return yield* engine.appUpdates.request({ payload: asked });
    })
  );
}

export function selectAppUpdates(machineId: string | null) {
  return views.get(resolveKey(machineId)) ?? EMPTY;
}

export function resetAppUpdates() {
  views = new Map();
  signal.publish();
}

export function refreshAppUpdates(machineId: string | null) {
  return runApp(read(machineId));
}

export function useAppUpdates(machineId: string | null, active = true) {
  useAppEffect(
    () => (active ? Effect.repeat(read(machineId), Schedule.spaced(APP_UPDATES_POLL)) : Effect.void),
    [machineId, active]
  );
  return React.useSyncExternalStore(signal.subscribe, () => selectAppUpdates(machineId));
}

export function createAppUpdatesActions(machineId: string | null): AppUpdatesActions {
  return {
    check: () => request(machineId, { kind: 'check' }),
    install: () => request(machineId, { kind: 'install' }),
    changeChannel: (channel) => request(machineId, { kind: 'channel', channel }),
    answerDowngrade: (accept) => request(machineId, { kind: 'downgrade', accept }),
    open: () =>
      run(
        machineId,
        'open',
        Effect.gen(function* () {
          const engine = yield* EngineClient;
          return yield* engine.appUpdates.open({ payload: {} });
        })
      ),
    restartEngine: () =>
      run(
        machineId,
        'restart',
        Effect.gen(function* () {
          const engine = yield* EngineClient;
          yield* engine.server.restart({ payload: { when: 'now' } });
          return null;
        })
      ),
  };
}
