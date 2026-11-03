import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Fiber, Layer, Option, Schedule, Stream } from 'effect';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { EffectFailed } from '../../src/runtime/failures/schema.ts';
import { Outbox } from '../../src/store/outbox/service.ts';
import { runTest } from '../harness.ts';

const EngineLayer = EngineCore.layer();

function runEngine<A, E>(effect: Effect.Effect<A, E, EngineCore | Outbox>) {
  return runTest(Effect.scoped(effect.pipe(Effect.provide(Layer.provideMerge(EngineLayer, Layer.empty)))));
}

const waitForStatus = Effect.fn('test.waitForStatus')(function* (kind: string, status: string) {
  const outbox = yield* Outbox;
  yield* outbox.listStatuses.pipe(
    Effect.map((rows) => rows.find((row) => row.kind === kind)?.status),
    Effect.repeat({ until: (found) => found === status, schedule: Schedule.spaced('10 millis') }),
    Effect.timeout('5 seconds')
  );
});

describe('EngineCore', () => {
  test('each committed command reaches the updates stream with the state before and what changed', async () => {
    const update = await runEngine(
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const next = yield* Stream.runHead(engine.updates).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        yield* engine.dispatch({ type: 'project.write', project: { name: 'Superwall', color: 'blue' } });
        return Option.getOrNull(yield* Fiber.join(next));
      })
    );
    const [projectId = ''] = update?.changes.projects ?? [];
    expect(update?.previous.projects[projectId]).toBeUndefined();
    expect(update?.state.projects[projectId]?.name).toBe('Superwall');
  });

  test('cancelling a task interrupts the fiber of its running effect', async () => {
    const interrupted = await runEngine(
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const started = yield* Deferred.make<void>();
        const stopped = yield* Deferred.make<boolean>();
        yield* engine.replaceHandlers({
          apply: (effect) =>
            effect.kind === 'task.triage'
              ? Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(stopped, true))
                )
              : Effect.void,
        });
        yield* engine.start;
        yield* engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
        yield* Deferred.await(started);
        const taskId = Object.keys((yield* engine.state).tasks)[0] ?? '';
        yield* engine.dispatch({ type: 'task.cancel', taskId });
        const result = yield* Deferred.await(stopped);
        yield* waitForStatus('task.triage', 'cancelled');
        yield* engine.stop;
        return result;
      })
    );
    expect(interrupted).toBe(true);
  });

  test('a defect in a handler is retried like a failure, and a final failure is not', async () => {
    const attempts = await runEngine(
      Effect.gen(function* () {
        const engine = yield* EngineCore;
        const seen: number[] = [];
        yield* engine.replaceHandlers({
          apply: (effect, { attempt }) => {
            if (effect.kind !== 'task.triage') return Effect.void;
            seen.push(attempt);
            if (attempt === 1) return Effect.die(new Error('broke'));
            return new EffectFailed({
              message: 'refused',
              detail: 'refused',
              retryable: false,
              delayMs: null,
            });
          },
        });
        yield* engine.start;
        yield* engine.dispatch({ type: 'task.create', request: 'Do it', repoId: null });
        yield* waitForStatus('task.triage', 'failed');
        yield* engine.stop;
        return seen;
      })
    );
    expect(attempts).toEqual([1, 2]);
  });
});
