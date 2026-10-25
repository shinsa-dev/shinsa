import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  type Run,
  type ShinsaEventInput,
  type ShinsaState,
} from '../../src/index.ts';

function stateWith(...runs: Partial<Run>[]): ShinsaState {
  const state = createState();
  for (const [index, run] of runs.entries()) {
    const id = run.id ?? `run-${index + 1}`;
    state.runs[id] = {
      id,
      taskId: 'task-1',
      role: 'agent',
      purpose: 'build',
      provider: 'claude',
      model: null,
      sessionId: null,
      startedAt: 1,
      endedAt: null,
      outcome: null,
      summary: null,
      ...run,
    };
  }
  return state;
}

function apply(state: ShinsaState, event: ShinsaEventInput) {
  return applyEvent(state, { ...event, seq: state.seq + 1, at: 50 });
}

describe('run events', () => {
  test('events for a run the log never started change nothing', () => {
    const state = stateWith();
    const events: ShinsaEventInput[] = [
      { type: 'run.linked', runId: 'ghost', sessionId: 's', provider: 'claude' },
      {
        type: 'run.attempted',
        runId: 'ghost',
        attemptId: 'a',
        provider: 'claude',
        model: null,
        resumed: false,
        handoff: null,
      },
      { type: 'run.interrupted', runId: 'ghost' },
      { type: 'run.continued', runId: 'ghost', reason: 'crash' },
    ];
    const next = events.reduce(apply, state);
    expect(next.runs).toEqual({});
  });

  test('a lost session marks every run that used it and nothing else', () => {
    const state = stateWith({ sessionId: 's1' }, { sessionId: 's1' }, { sessionId: 's2' });
    const next = apply(state, { type: 'run.session_lost', runId: 'run-1', sessionId: 's1' });
    expect(Object.values(next.runs).map((run) => run.sessionLost ?? false)).toEqual([true, true, false]);
  });

  test('a failure is stored with the end, and an end without one stores none', () => {
    const failure = {
      class: 'auth',
      message: 'Sign in.',
      code: null,
      retryable: false,
      resetAt: null,
    } as const;
    const failed = apply(stateWith({}), {
      type: 'run.ended',
      runId: 'run-1',
      outcome: 'failed',
      summary: 'x',
      failure,
    });
    expect(failed.runs['run-1']?.failure).toEqual(failure);
    const plain = apply(stateWith({}), {
      type: 'run.ended',
      runId: 'run-1',
      outcome: 'completed',
      summary: null,
    });
    expect(plain.runs['run-1']).not.toHaveProperty('failure');
  });

  test('a run whose role or purpose the current model does not have is refused, never stored', () => {
    const base = stateWith().runs;
    const run = (patch: Record<string, unknown>) =>
      ({ ...stateWith({ id: 'new' }).runs.new, ...patch }) as Run;
    const delegation = stateWith({
      delegation: {
        parentRunId: 'run-0',
        depth: 1,
        requestKey: 'k',
        title: 't',
        brief: 'b',
        mode: 'wait',
        wake: 'settled_only',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: null,
        requestedAt: 1,
      },
    }).runs['run-1']?.delegation;
    const refused = [
      [run({ role: 'operator' }), 'run_role_unknown', 'a run of its own'],
      [run({ role: 'planner', purpose: undefined }), 'run_role_unknown', 'a run of its own'],
      [run({ role: 'answerer', delegation }), 'run_role_unknown', 'a delegated run'],
      [run({ purpose: undefined }), 'run_purpose_unknown', 'no known purpose'],
      [run({ purpose: 'ship' }), 'run_purpose_unknown', 'no known purpose'],
      [run({ role: 'reviewer' }), 'run_purpose_unexpected', 'cannot have a purpose'],
    ] as const;
    for (const [started, code, message] of refused) {
      const state = stateWith();
      const refusal = (() => {
        try {
          apply(state, { type: 'run.started', run: started });
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(refusal).toMatchObject({ code, message: expect.stringContaining(message) });
      expect(state.runs).toEqual(base);
    }
    const helper = run({ role: 'builder', purpose: undefined, delegation });
    expect(apply(stateWith(), { type: 'run.started', run: helper }).runs.new?.role).toBe('builder');
  });
});
