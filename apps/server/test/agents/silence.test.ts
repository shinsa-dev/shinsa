import { describe, expect, spyOn, test } from 'bun:test';
import type { ShinsaCommand } from '@shinsa/core';
import { SilenceWatch, Transcripts } from '../../src/agents/index.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir, until } from '../helpers/index.ts';
import { createGate, createRun, createStubEngine } from '../helpers/state.ts';

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
  const transcripts = new Transcripts(createTempDir());
  const watch = new SilenceWatch(stub.engine, transcripts, { now: () => now.value, intervalMs: 5 });
  return { ...stub, transcripts, watch };
}

function silences(dispatched: ShinsaCommand[]) {
  return dispatched.filter((command) => command.type === 'run.silence');
}

describe('the silent-run watch', () => {
  test('a running run quiet for five minutes is marked from its last output, once', async () => {
    const now = { value: 4 * MINUTE };
    const { watch, dispatched, commandIds } = setup(now);
    await watch.check();
    expect(silences(dispatched)).toEqual([]);
    now.value = 5 * MINUTE;
    await watch.check();
    expect(silences(dispatched)).toEqual([{ type: 'run.silence', runId: 'run-1', since: 0 }]);
    expect(commandIds).toEqual(['run.silence:run-1:0']);
  });

  test('a run waiting on an answer, from the human or from the agent that delegated it, is never marked', async () => {
    const now = { value: 10 * MINUTE };
    const { watch, dispatched, update } = setup(now);
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
  });

  test('the last thing in the transcript counts as output after a restart, and output clears a mark', async () => {
    const now = { value: 0 };
    const { watch, dispatched, commandIds, transcripts, update } = setup(now);
    transcripts.record('run-1', { type: 'agent', phase: 'interim', text: 'working' });
    const last = transcripts.listEntries('run-1').at(-1)?.at ?? 0;
    now.value = last + 6 * MINUTE;
    watch.start();
    watch.start();
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
    watch.stop();
    watch.stop();
  });

  test('the periodic check runs on its own, and a failed record is logged', async () => {
    const now = { value: 10 * MINUTE };
    const { watch, dispatched, reject } = setup(now);
    reject((command) => command.type === 'run.silence');
    watch.start();
    await until('a check', () => silences(dispatched).length > 0);
    watch.stop();
    const quiet = setup({ value: 0 });
    quiet.reject((command) => command.type === 'run.silence');
    quiet.transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'back' });
    quiet.watch.start();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    quiet.transcripts.record('run-3', { type: 'agent', phase: 'interim', text: 'back' });
    await until('the failed record to be logged', () => warn.mock.calls.length > 0);
    warn.mockRestore();
    quiet.watch.stop();
    expect(silences(quiet.dispatched)).toHaveLength(1);
  });
});
