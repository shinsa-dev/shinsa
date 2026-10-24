import { describe, expect, spyOn, test } from 'bun:test';
import { createState, type ShinsaState } from '@shinsa/core';
import {
  COMPACTION_NEAR_LIMIT,
  IdleCompaction,
  resolveCompactionWindow,
} from '../../src/agents/compaction.ts';
import type { SessionContext } from '../../src/agents/providers/index.ts';
import { log } from '../../src/log/index.ts';
import { until } from '../helpers/index.ts';
import { createGate, createRun, createTask } from '../helpers/state.ts';

const NOW = 1_000_000;

const HOUR = 60 * 60_000;

const WINDOW = 200_000;

const CONTEXT: SessionContext = {
  usedTokens: 170_000,
  maxTokens: WINDOW,
  cacheExpiresAt: NOW + HOUR,
  backgroundWork: false,
};

function idleState(patch: (state: ShinsaState) => void = () => undefined) {
  const state = createState();
  Object.assign(state.settings, { compaction: 'claude', idleCompaction: true });
  state.tasks['task-1'] = createTask({ stage: 'awaiting_review' });
  state.runs['run-1'] = createRun({
    role: 'agent',
    purpose: 'fix',
    sessionId: 's1',
    endedAt: 5,
    outcome: 'completed',
    startedAt: 2,
  });
  patch(state);
  return state;
}

describe('when an idle session compacts', () => {
  test('two minutes before its prompt cache expires', () => {
    expect(resolveCompactionWindow(idleState(), 'run-1', CONTEXT, NOW)).toEqual({
      runId: 'run-1',
      sessionId: 's1',
      startAt: NOW + HOUR - 2 * 60_000,
    });
  });

  test('an answerer, investigator or researcher whose session the next message resumes compacts too', () => {
    for (const role of ['answerer', 'investigator', 'researcher'] as const) {
      const state = idleState((draft) => {
        Object.assign(draft.tasks['task-1'] ?? {}, { stage: 'awaiting_proposal' });
        Object.assign(draft.runs['run-1'] ?? {}, { role });
      });
      expect(resolveCompactionWindow(state, 'run-1', CONTEXT, NOW)?.sessionId).toBe('s1');
    }
  });

  test('the lead time follows the setting', () => {
    const state = idleState((draft) => {
      draft.settings.compactionLeadMinutes = 10;
    });
    expect(resolveCompactionWindow(state, 'run-1', CONTEXT, NOW)?.startAt).toBe(NOW + HOUR - 10 * 60_000);
  });

  test.each<[string, (state: ShinsaState) => void, Partial<SessionContext> | null]>([
    ['the setting is off', (state) => void Object.assign(state.settings, { idleCompaction: false }), {}],
    ['it was never turned on', (state) => void Reflect.deleteProperty(state.settings, 'idleCompaction'), {}],
    [
      'eunoe compacts instead',
      (state) => void Object.assign(state.settings, { compaction: 'eunoe_compact' }),
      {},
    ],
    ['nothing compacts', (state) => void Object.assign(state.settings, { compaction: 'off' }), {}],
    ['the run is gone', (state) => void Reflect.deleteProperty(state.runs, 'run-1'), {}],
    ['the task is gone', (state) => void Reflect.deleteProperty(state.tasks, 'task-1'), {}],
    ['nothing is known about the session', () => undefined, null],
    ['the run failed', (state) => void Object.assign(state.runs['run-1'] ?? {}, { outcome: 'failed' }), {}],
    [
      'the run has no session',
      (state) => void Object.assign(state.runs['run-1'] ?? {}, { sessionId: null }),
      {},
    ],
    [
      'the session was compacted already',
      (state) => void Object.assign(state.runs['run-1'] ?? {}, { compactions: ['s1'] }),
      {},
    ],
    [
      'a later step would not resume it',
      (state) => void Object.assign(state.runs['run-1'] ?? {}, { role: 'reviewer' }),
      {},
    ],
    [
      'it is a delegated agent',
      (state) => void Object.assign(state.runs['run-1'] ?? {}, { delegation: { parentRunId: 'p' } }),
      {},
    ],
    [
      'its task was delegated',
      (state) => void Object.assign(state.tasks['task-1'] ?? {}, { parentTaskId: 'p' }),
      {},
    ],
    [
      'its task is finished',
      (state) => void Object.assign(state.tasks['task-1'] ?? {}, { stage: 'merged' }),
      {},
    ],
    [
      'another run is working on the task',
      (state) => {
        state.runs['run-2'] = createRun({ id: 'run-2', role: 'reviewer' });
      },
      {},
    ],
    [
      'a question or secret request is open',
      (state) => {
        state.gates.g1 = createGate({ id: 'g1', runId: 'run-1' });
      },
      {},
    ],
    [
      'a newer step has its own session',
      (state) => {
        state.runs['run-3'] = createRun({
          id: 'run-3',
          role: 'agent',
          startedAt: 9,
          endedAt: 10,
          outcome: 'completed',
        });
      },
      {},
    ],
    ['background work is still pending', () => undefined, { backgroundWork: true }],
    [
      'the context is not near its limit',
      () => undefined,
      { usedTokens: WINDOW * COMPACTION_NEAR_LIMIT - 1 },
    ],
    ['a large context still has room in a larger window', () => undefined, { maxTokens: 1_000_000 }],
    ['the context size is unknown', () => undefined, { usedTokens: null }],
    ['the context window is unknown', () => undefined, { maxTokens: null }],
    ['the cache lifetime is unknown', () => undefined, { cacheExpiresAt: null }],
    ['the cache has already expired', () => undefined, { cacheExpiresAt: NOW }],
  ])('never when %s', (_name, patch, context) => {
    const state = idleState(patch);
    expect(
      resolveCompactionWindow(state, 'run-1', context ? { ...CONTEXT, ...context } : null, NOW)
    ).toBeNull();
  });

  test('a delegated run on the same task does not count as a newer step', () => {
    const state = idleState((draft) => {
      draft.runs['run-4'] = createRun({
        id: 'run-4',
        role: 'builder',
        startedAt: 9,
        endedAt: 10,
        delegation: { parentRunId: 'run-1' },
      } as never);
    });
    expect(resolveCompactionWindow(state, 'run-1', CONTEXT, NOW)).not.toBeNull();
  });
});

describe('the compaction timer', () => {
  function setUp(state: ShinsaState, now: () => number) {
    const started: string[] = [];
    let finish: () => void = () => undefined;
    const compaction = new IdleCompaction(
      () => state,
      (runId, sessionId) => {
        started.push(`${runId}:${sessionId}`);
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
      { now }
    );
    return { compaction, started, finish: () => finish() };
  }

  test('compacts when the window opens, and a new run on the task waits for it to finish', async () => {
    const state = idleState();
    const { compaction, started, finish } = setUp(state, () => NOW + HOUR - 60_000);
    compaction.record('run-1', CONTEXT);
    compaction.schedule('task-1');
    await until('the compaction', () => started.length === 1);
    expect(started).toEqual(['run-1:s1']);
    let settled = false;
    const waiting = compaction.settle('task-1').then(() => {
      settled = true;
    });
    await Bun.sleep(0);
    expect(settled).toBe(false);
    finish();
    await waiting;
    expect(settled).toBe(true);
  });

  test('a newer run, a cancel or a stop drops the waiting compaction', async () => {
    const state = idleState();
    let now = NOW;
    let reads = 0;
    const started: string[] = [];
    const compaction = new IdleCompaction(
      () => {
        reads += 1;
        return state;
      },
      (runId) => {
        started.push(runId);
        return Promise.resolve();
      },
      { now: () => now }
    );
    compaction.schedule('task-1');
    compaction.record('run-1', CONTEXT);
    compaction.schedule('task-1');
    compaction.cancel('task-1');
    compaction.cancel('task-1');
    compaction.schedule('task-1');
    await compaction.stop();
    compaction.record('missing', CONTEXT);
    compaction.record('run-1', { ...CONTEXT, usedTokens: 10 });
    compaction.schedule('task-1');
    compaction.record('run-1', CONTEXT);
    now = NOW + HOUR - 60_000;
    compaction.schedule('task-1');
    state.runs['run-2'] = createRun({ id: 'run-2' });
    const scheduled = reads;
    await until('the timer to look again', () => reads > scheduled);
    expect(started).toEqual([]);
    await compaction.settle('task-1');
  });

  test('only the last session a later step would resume is remembered, and a finished task forgets it', () => {
    const state = idleState((draft) => {
      draft.runs['run-5'] = createRun({ id: 'run-5', role: 'reviewer', endedAt: 9, outcome: 'completed' });
      draft.runs['run-6'] = createRun({
        id: 'run-6',
        role: 'builder',
        delegation: { parentRunId: 'run-1' },
      } as never);
    });
    const { compaction, started } = setUp(state, () => NOW);
    compaction.record('run-1', CONTEXT);
    compaction.record('run-5', null);
    compaction.record('run-6', null);
    compaction.schedule('task-1');
    compaction.cancel('task-1');
    state.tasks['task-1'] = createTask({ stage: 'merged' });
    compaction.schedule('task-1');
    compaction.schedule('task-1');
    state.tasks['task-1'] = createTask({ stage: 'awaiting_review' });
    compaction.schedule('task-1');
    Reflect.deleteProperty(state.tasks, 'task-1');
    compaction.record('run-1', CONTEXT);
    compaction.schedule('task-1');
    expect(started).toEqual([]);
  });

  test('a failed compaction is logged', async () => {
    const state = idleState();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const compaction = new IdleCompaction(
      () => state,
      () => Promise.reject(new Error('cli gone')),
      {
        now: () => NOW + HOUR - 60_000,
      }
    );
    compaction.record('run-1', CONTEXT);
    compaction.schedule('task-1');
    await until('the warning', () => warn.mock.calls.length > 0);
    expect(warn).toHaveBeenCalledWith('[Compaction] An idle session could not be compacted', {
      runId: 'run-1',
      error: 'cli gone',
    });
    warn.mockRestore();
  });
});
