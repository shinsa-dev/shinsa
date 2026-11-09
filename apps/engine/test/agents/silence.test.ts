import { describe, expect, test } from 'bun:test';
import type { ShinsaCommand } from '@shinsa/core';
import { Exit, Scope } from 'effect';
import { watchSilence } from '../../src/agents/index.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { captureLogs } from '../helpers/logs.ts';
import { testRuntime } from '../helpers/runtime.ts';
import { createGate, createRun, createStubEngine } from '../helpers/state.ts';
import { createSyncTranscripts } from '../helpers/transcripts.ts';

const MINUTE = 60_000;

function setup(now: { value: number }) {
  const stub = createStubEngine((state) => {
    state.runs['run-1'] = createRun({ startedAt: 0 });
    state.runs['run-2'] = createRun({ id: 'run-2', status: 'queued', startedAt: 0 });
    state.runs['run-3'] = createRun({
      id: 'run-3',
      startedAt: 0,
      silence: { since: 0, snoozedUntil: null, dismissed: false },
    });
  });
  const transcripts = createSyncTranscripts(createTempDir());
  const start = async (intervalMs = 60_000) => {
    const scope = Scope.makeUnsafe();
    const handle = await testRuntime.runPromise(
      watchSilence(stub.engine.core, transcripts.service, { now: () => now.value, intervalMs }).pipe(
        Scope.provide(scope)
      )
    );
    return {
      check: () => testRuntime.runPromise(handle.check),
      stop: () => testRuntime.runPromise(Scope.close(scope, Exit.void)),
    };
  };
  return { ...stub, transcripts, start };
}

function silences(dispatched: ShinsaCommand[]) {
  return dispatched.filter((command) => command.type === 'run.silence');
}

describe('the silent-run watch', () => {
  test('a running run quiet for five minutes is marked from its last output, once', async () => {
    const now = { value: 4 * MINUTE };
    const { start, dispatched, commandIds } = setup(now);
    const watch = await start();
    await watch.check();
    expect(silences(dispatched)).toEqual([]);
    now.value = 5 * MINUTE;
    await watch.check();
    expect(silences(dispatched)).toEqual([{ type: 'run.silence', runId: 'run-1', since: 0 }]);
    expect(commandIds).toEqual(['run.silence:run-1:0']);
    await watch.stop();
  });

  test('a run waiting on an answer, from the human or from the agent that delegated it, is never marked', async () => {
    const now = { value: 10 * MINUTE };
    const { start, dispatched, update } = setup(now);
    const watch = await start();
    update((state) => {
      state.runs['run-1'] = createRun({ startedAt: 0, status: 'waiting' });
      Reflect.deleteProperty(state.runs, 'run-3');
      state.runs.asker = createRun({ id: 'asker', startedAt: 0 });
      state.gates['gate-1'] = createGate({ runId: 'asker' });
      state.runs.child = createRun({
        id: 'child',
        role: 'reviewer',
        startedAt: 0,
        delegation: {
          parentRunId: 'run-1',
          depth: 1,
          requestKey: 'k',
          title: 'Survey',
          brief: 'Survey.',
          mode: 'async',
          wake: 'always',
          isolation: 'shared',
          baseCommit: null,
          delivery: 'none',
          question: {
            id: 'q-1',
            question: 'Which file?',
            context: null,
            choices: [],
            recommendation: null,
            askedAt: 1,
            delivered: true,
            answer: null,
            answeredAt: null,
          },
          requestedAt: 1,
        },
      });
    });
    await watch.check();
    expect(silences(dispatched)).toEqual([]);
    await watch.stop();
  });

  test('the last thing in the transcript counts as output after a restart, and output clears a mark', async () => {
    const now = { value: 0 };
    const { start, dispatched, commandIds, transcripts, update } = setup(now);
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'working' });
    const last = transcripts.listEntries('run-1').at(-1)?.at ?? 0;
    now.value = last + 6 * MINUTE;
    const watch = await start();
    await watch.check();
    expect(silences(dispatched)).toEqual([{ type: 'run.silence', runId: 'run-1', since: last }]);
    transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'back' });
    expect(silences(dispatched).at(-1)).toEqual({ type: 'run.silence', runId: 'run-3', since: null });
    expect(commandIds.at(-1)).toBe('run.silence:run-3:0:heard');
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'still here' });
    expect(silences(dispatched)).toHaveLength(2);
    update((state) => {
      state.runs['run-1'] = createRun({ endedAt: 9 });
    });
    await watch.check();
    await watch.stop();
    transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'after' });
    expect(silences(dispatched)).toHaveLength(2);
  });

  test('the periodic check runs on its own, and a failed record is logged', async () => {
    const now = { value: 10 * MINUTE };
    const { start, dispatched, reject } = setup(now);
    reject((command) => command.type === 'run.silence');
    const watch = await start(5);
    await until('a check', () => silences(dispatched).length > 0);
    await watch.stop();
    const quiet = setup({ value: 0 });
    quiet.reject((command) => command.type === 'run.silence');
    await quiet.transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'back' });
    const quietWatch = await quiet.start(5);
    const logs = captureLogs();
    try {
      await quiet.transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'back' });
      await until(
        'the failed record to be logged',
        () => logs.fieldsOf('[Silence] Could not record a quiet run').length > 0
      );
    } finally {
      logs.restore();
    }
    await quietWatch.stop();
    expect(silences(quiet.dispatched)).toHaveLength(1);
  });
});
