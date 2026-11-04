import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Context, Duration, Effect, Exit, Layer, Scope, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { JsonLogger } from '../../src/log/service.ts';
import type { EngineClock } from '../../src/runtime/clock/schema.ts';
import type { EngineStopped, StateListener } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';

export type FakeReply = readonly unknown[] | DomainError | EngineStopped;

interface SentCommand {
  command: ShinsaCommand;
  id: string | undefined;
}

export function createFakeEngineCore(state: ShinsaState, answer: (command: ShinsaCommand) => FakeReply) {
  const listeners = new Set<StateListener>();
  const sent: SentCommand[] = [];
  const core = EngineCore.of({
    readOnly: false,
    problems: [],
    state: Effect.sync(() => state),
    updates: Stream.empty,
    observe: (listener) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => listeners.add(listener)),
          () => Effect.sync(() => listeners.delete(listener))
        )
      ),
    dispatch: (command, options) =>
      Effect.suspend(() => {
        sent.push({ command, id: options?.id });
        const reply = answer(command);
        return Array.isArray(reply)
          ? Effect.succeed(reply as ShinsaEvent[])
          : Effect.fail(reply as DomainError | EngineStopped);
      }),
    writeBriefing: () => Effect.void,
    hasReceipt: () => Effect.succeed(false),
    writeSnapshot: Effect.succeed(false),
    replaceHandlers: () => Effect.void,
    start: Effect.void,
    stop: Effect.void,
    settle: Effect.void,
  });
  const notify = () => {
    for (const listener of listeners) listener(state, { previous: state, changes: {} } as never);
  };
  return { core, sent, listeners, notify };
}

export interface ServicesOptions {
  now?: number;
  liveClock?: boolean;
}

export async function openServices<ROut, E>(
  layer: Layer.Layer<ROut, E, EngineCore>,
  engine: EngineCore['Service'],
  options: ServicesOptions = {}
) {
  const scope = Effect.runSync(Scope.make());
  const built = layer.pipe(
    Layer.provide(Layer.succeed(EngineCore, engine)),
    Layer.provideMerge(JsonLogger),
    Layer.provideMerge(options.liveClock ? Layer.empty : TestClock.layer())
  );
  const context = (await Effect.runPromise(Layer.buildWithScope(built, scope))) as Context.Context<ROut>;
  const run = <A, F>(effect: Effect.Effect<A, F, ROut>) => Effect.runPromiseWith(context)(effect);
  const harness = {
    run,
    service: <I, S>(tag: Context.Key<I, S>) => Context.get(context as unknown as Context.Context<I>, tag),
    setTime: (now: number) => run(TestClock.setTime(now)),
    adjust: (ms: number) => run(TestClock.adjust(Duration.millis(ms))),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
  if (options.now !== undefined) await harness.setTime(options.now);
  return harness;
}

export async function openClock<I>(
  tag: Context.Key<I, EngineClock>,
  layer: Layer.Layer<I, never, EngineCore>,
  engine: EngineCore['Service'],
  options: ServicesOptions = {}
) {
  const harness = await openServices(layer, engine, options);
  const clock = harness.service(tag);
  return {
    ...harness,
    fireDue: () => harness.run(clock.fireDue),
    start: () => harness.run(clock.start),
    stop: () => harness.run(clock.stop),
  };
}
