import { describe, expect, test } from 'bun:test';
import type { Gate } from '@shinsa/core';
import { Questions } from '../../src/agents/questions.ts';
import { Transcripts } from '../../src/agents/transcripts/index.ts';
import { createTempDir } from '../helpers/index.ts';
import { createStubEngine, createTask } from '../helpers/state.ts';

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
    const questions = new Questions({
      engine: stub.engine,
      transcripts: new Transcripts(createTempDir()),
      active: new Map(),
      execute: () => Promise.resolve(),
    });
    expect(questions.resolve('gate-1')).rejects.toThrow('The task is gone.');
  });
});
