import { Duration, Effect, Scope } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { IDLE_RELEASE, MAX_IDLE_PIN_MS } from './idle/schema.ts';
import { QuestionFailed, type QuestionsHandle, type QuestionsOptions } from './questions/schema.ts';
import { makeQuestions } from './questions/service.ts';

export type { QuestionsOptions } from './questions/schema.ts';

function fail(error: unknown) {
  return new QuestionFailed({ message: describeError(error) });
}

export class Questions {
  readonly #handle: QuestionsHandle;

  constructor({ engine, transcripts, active, execute, idle = {} }: QuestionsOptions) {
    const now = idle.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeQuestions({
        state: Effect.sync(() => engine.state),
        active,
        execute: (runId, prompt) => Effect.tryPromise({ try: () => execute(runId, prompt), catch: fail }),
        dispatch: (command, id) =>
          Effect.tryPromise({ try: () => engine.dispatch(command, { id }), catch: fail }).pipe(Effect.asVoid),
        record: (runId, entry) => Effect.sync(() => transcripts.record(runId, entry)),
        newId: Effect.sync(() => Bun.randomUUIDv7()),
        idle: {
          idle: idle.idleMs === undefined ? IDLE_RELEASE : Duration.millis(idle.idleMs),
          maxPinMs: idle.maxPinMs ?? MAX_IDLE_PIN_MS,
          now: Effect.sync(now),
        },
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  get handle() {
    return this.#handle;
  }

  touch(runId: string) {
    edgeRuntime.runSync(this.#handle.touch(runId));
  }

  forget(runId: string) {
    edgeRuntime.runSync(this.#handle.forget(runId));
  }

  releaseWaiting(runId: string) {
    return edgeRuntime.runPromise(this.#handle.releaseWaiting(runId));
  }

  resolve(gateId: string) {
    return edgeRuntime.runPromise(this.#handle.resolve(gateId));
  }

  replyToDelegate(runId: string, questionId: string) {
    return edgeRuntime.runPromise(this.#handle.replyToDelegate(runId, questionId));
  }
}
