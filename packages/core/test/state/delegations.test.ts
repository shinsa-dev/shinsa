import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  describeDelegateRole,
  listDelegatedRuns,
  parseDeliveryItem,
  type Run,
  type RunDelegation,
  resolveCohort,
  type ShinsaState,
  selectRootRun,
} from '../../src/index.ts';

function stepRun(id: string, patch: Partial<Run> = {}): Run {
  return {
    id,
    taskId: 't',
    role: 'builder',
    status: 'running',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    summary: null,
    ...patch,
  };
}

function delegation(parentRunId: string): RunDelegation {
  return {
    parentRunId,
    depth: 1,
    requestKey: parentRunId,
    title: 'Check',
    brief: 'Check it.',
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: 0,
  };
}

function withRuns(...runs: Run[]): ShinsaState {
  const state = createState();
  for (const run of runs) state.runs[run.id] = run;
  return state;
}

describe('delivery items', () => {
  test('read back from their wire form', () => {
    expect(parseDeliveryItem('result:r1')).toEqual({ kind: 'result', runId: 'r1' });
    expect(parseDeliveryItem('question:r1:q1')).toEqual({ kind: 'question', runId: 'r1', questionId: 'q1' });
    expect(parseDeliveryItem('message:m1')).toEqual({ kind: 'message', messageId: 'm1' });
  });

  test('anything else is not an item', () => {
    expect(parseDeliveryItem('result')).toBeNull();
    expect(parseDeliveryItem('question:r1')).toBeNull();
    expect(parseDeliveryItem('settled')).toBeNull();
  });
});

describe('the tree of delegated runs', () => {
  test('the root is the step run at the top of the chain', () => {
    const state = withRuns(
      stepRun('step'),
      stepRun('a', { delegation: delegation('step') }),
      stepRun('b', { delegation: delegation('a') })
    );
    expect(selectRootRun(state, state.runs.b as Run)?.id).toBe('step');
    expect(selectRootRun(state, state.runs.step as Run)?.id).toBe('step');
  });

  test('a chain that loops or loses its top has no root', () => {
    const looped = withRuns(
      stepRun('a', { delegation: delegation('b') }),
      stepRun('b', { delegation: delegation('a') })
    );
    expect(selectRootRun(looped, looped.runs.a as Run)).toBeNull();
    const orphan = withRuns(stepRun('a', { delegation: delegation('gone') }));
    expect(selectRootRun(orphan, orphan.runs.a as Run)).toBeNull();
  });

  test('a task’s delegated runs are listed oldest first, and step runs are not among them', () => {
    const state = withRuns(
      stepRun('step'),
      stepRun('late', { startedAt: 5, delegation: delegation('step') }),
      stepRun('early', { startedAt: 2, delegation: delegation('step') }),
      stepRun('other', { taskId: 'u', delegation: delegation('step') })
    );
    expect(listDelegatedRuns(state, 't').map((run) => run.id)).toEqual(['early', 'late']);
  });

  test('a run with no cohort yet starts at the first generation', () => {
    expect(resolveCohort(stepRun('step'))).toEqual({
      nextGeneration: 1,
      claim: null,
      deferred: false,
      messages: [],
    });
  });

  test('roles are named the way a person says them', () => {
    expect(describeDelegateRole('investigator')).toBe('investigator');
  });
});

describe('projecting delegation events', () => {
  test('events about runs or tasks that are gone change nothing', () => {
    const state = withRuns(stepRun('step'));
    const before = JSON.stringify(state);
    const events = [
      { type: 'delegation.asked', runId: 'gone', question: { id: 'q' } },
      { type: 'delegation.asked', runId: 'step', question: { id: 'q' } },
      { type: 'delegation.answered', runId: 'step', questionId: 'q', answer: 'A' },
      { type: 'delegation.acknowledged', runId: 'gone' },
      { type: 'delegation.wake_changed', runId: 'step', wake: 'always' },
      { type: 'delegation.claimed', runId: 'gone', claim: { generation: 1, items: [], via: 'steer' } },
      { type: 'delegation.delivered', runId: 'gone', generation: 1, items: [], via: 'steer' },
      { type: 'delegation.released', runId: 'gone', generation: 1, items: ['result:gone'], deferred: false },
      { type: 'delegation.message_queued', runId: 'gone', message: { id: 'm', text: 'x' } },
      { type: 'task.split', taskId: 'gone', split: { planVersion: 1, runId: 'step', taskIds: [], at: 0 } },
    ];
    let seq = 0;
    for (const event of events) {
      applyEvent(state, { ...event, seq: ++seq, at: 0 } as Parameters<typeof applyEvent>[1]);
    }
    expect(JSON.stringify({ ...state, seq: 0 })).toBe(JSON.stringify({ ...JSON.parse(before), seq: 0 }));
  });

  test('a delivery marks only the items it names, and only from the state they were in', () => {
    const state = withRuns(
      stepRun('step'),
      stepRun('done', {
        endedAt: 1,
        outcome: 'completed',
        delegation: { ...delegation('step'), delivery: 'acknowledged' },
      })
    );
    applyEvent(state, {
      type: 'delegation.delivered',
      runId: 'step',
      generation: 1,
      items: ['result:done', 'result:step', 'question:done:q', 'nonsense'],
      via: 'steer',
      seq: 1,
      at: 0,
    });
    expect(state.runs.done?.delegation?.delivery).toBe('acknowledged');
  });

  test('a task created by nobody in particular is just a task', () => {
    const state = createState();
    applyEvent(state, {
      type: 'task.created',
      taskId: 't',
      request: 'Do it.',
      repoId: null,
      priority: 'normal',
      planFirst: false,
      origin: null,
      auto: { shape: true, start: true, priority: true },
      seq: 1,
      at: 0,
    });
    expect(state.tasks.t?.createdBy).toBeUndefined();
    applyEvent(state, {
      type: 'task.created',
      taskId: 'gone',
      request: 'Do it.',
      repoId: null,
      priority: 'normal',
      planFirst: false,
      origin: null,
      auto: { shape: true, start: true, priority: true },
      createdBy: { kind: 'split', taskId: 't', runId: 'r', requestKey: 'plan:1' },
      parentTaskId: 't',
      seq: 2,
      at: 0,
    });
    expect(state.tasks.gone).toMatchObject({ parentTaskId: 't', createdBy: { kind: 'split' } });
    expect(state.tasks.t?.activity).toHaveLength(1);
  });
});
