import { DomainError, type ShinsaCommand, type ShinsaEvent, type ShinsaState } from '@shinsa/core';
import { Effect, Layer, Stream } from 'effect';
import { describeError } from '../../src/log/redact.ts';
import { EngineStopped, type WrittenBriefing } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import type { StubEngine } from './state.ts';

interface StubEngineCalls {
  subscribe: (listener: (state: ShinsaState) => void) => () => void;
  dispatch: (command: ShinsaCommand, options?: { id?: string }) => Promise<ShinsaEvent[]>;
  writeBriefing: (projectId: string | null, written: WrittenBriefing) => Promise<void>;
}

function toEngineFailure(error: unknown) {
  if (error instanceof DomainError) return error;
  return new EngineStopped({ message: describeError(error) });
}

function createStubEngineCore(stub: StubEngine) {
  const calls = stub.engine as unknown as StubEngineCalls;
  return EngineCore.of({
    readOnly: false,
    problems: [],
    state: Effect.sync(() => stub.state),
    updates: Stream.empty,
    observe: (listener) =>
      Effect.asVoid(
        Effect.acquireRelease(
          Effect.sync(() => calls.subscribe((state) => listener(state, { previous: state, changes: {} }))),
          (unsubscribe) => Effect.sync(unsubscribe)
        )
      ),
    dispatch: (command, options) =>
      Effect.tryPromise({
        try: () => calls.dispatch(command, options?.id === undefined ? {} : { id: options.id }),
        catch: toEngineFailure,
      }),
    writeBriefing: (projectId, written) =>
      Effect.tryPromise({ try: () => calls.writeBriefing(projectId, written), catch: toEngineFailure }),
    hasReceipt: () => Effect.succeed(false),
    writeSnapshot: Effect.succeed(false),
    replaceHandlers: () => Effect.void,
    start: Effect.void,
    stop: Effect.void,
    settle: Effect.void,
  });
}

export function createStubEngineCoreLayer(stub: StubEngine) {
  return Layer.succeed(EngineCore, createStubEngineCore(stub));
}
