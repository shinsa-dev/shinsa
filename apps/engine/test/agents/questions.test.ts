import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import type { Gate } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { Questions } from '../../src/agents/questions/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { createStubEngine, createTask } from '../helpers/state.ts';
import { createLiveRuns } from './live-runs.ts';

describe('answers to an agent’s questions', () => {
  test('an answer the engine refuses to deliver fails with the engine’s reason', async () => {
    const stub = createStubEngine((state) => {
      state.tasks['task-1'] = createTask();
      state.gates['gate-1'] = {
        id: 'gate-1',
        taskId: 'task-1',
        runId: null,
        title: 'Which colour?',
        status: 'answered',
        response: 'Blue',
      } as unknown as Gate;
    });
    stub.reject((command) => command.type === 'message.deliver', new Error('The task is gone.'));
    const layer = Questions.layer.pipe(
      Layer.provide(
        Layer.merge(createLiveRuns().layer, Layer.succeed(EngineCore, stub.engine.core)).pipe(
          Layer.provideMerge(BunServices.layer)
        )
      )
    );
    const failure = await Effect.runPromise(
      Effect.flip(Questions.use((questions) => questions.resolve('gate-1'))).pipe(Effect.provide(layer))
    );
    expect(failure.message).toBe('The task is gone.');
  });
});
