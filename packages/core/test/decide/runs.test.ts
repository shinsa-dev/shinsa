import { describe, expect, test } from 'bun:test';
import { listActiveRuns, listOpenGates, type RunFailure } from '../../src/index.ts';
import {
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  proposePlan,
  registerRepo,
} from '../harness.ts';

describe('recovery', () => {
  test('an agent that ends without handing over is resumed once with a nudge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'plan-1');
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const second = harness.activeRun(taskId);
    expect(second).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(second.sessionId).toBe('plan-1');
    expect(second.prompt).toContain('ended its turn without calling the hand-over tool');
    expect(harness.task(taskId).recoveries).toBe(1);
  });

  test('a second stop opens a failure gate, and retry starts the step again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    const gate = harness.openGate(taskId);
    expect(gate.type).toBe('failure');
    expect(gate.title).toBe('The agent paused');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    const run = harness.activeRun(taskId);
    expect(run).toMatchObject({ role: 'agent', purpose: 'build' });
    expect(run.phaseIndex).toBe(0);
    expect(harness.task(taskId).recoveries).toBe(0);
  });

  test('progress resets the recovery budget', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'completed',
      summary: null,
    });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).recoveries).toBe(0);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'completed',
      summary: null,
    });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'build' });
  });

  test('run.end after the agent handed over is ignored', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const planner = harness.activeRun(taskId);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: planner.id, outcome: 'failed', summary: 'late' });
    expect(harness.activeRun(taskId).id).toBe(builder.id);
    expect(listOpenGates(harness.state, taskId)).toHaveLength(0);
  });

  test('rejecting a failure gate cancels the task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'effect.fail', taskId, title: 'Worktree failed', detail: 'disk full' });
    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(taskId).id,
      decision: 'reject',
      response: null,
    });
    expect(harness.task(taskId).stage).toBe('cancelled');
  });
});

describe('the project a recovered agent is told about', () => {
  const LINE = 'This task belongs to the project Basket';

  function countContext(prompt: string | undefined) {
    return (prompt ?? '').split(LINE).length - 1;
  }

  function inProject() {
    const harness = createHarness();
    harness.send({ type: 'project.write', project: { name: 'Basket', color: 'green', key: 'BAS' } });
    const repo = registerRepo(harness, 'server', 'Basket');
    return { harness, taskId: createTask(harness, { repoId: repo }) };
  }

  test('a fresh session after a full context window is told about the project once', () => {
    const { harness, taskId } = inProject();
    linkSession(harness, taskId, 'plan-1');
    const first = harness.activeRun(taskId);
    expect(countContext(first.prompt)).toBe(1);
    const full: RunFailure = {
      class: 'context_window_full',
      message: 'The context window is full.',
      code: null,
      retryable: false,
      resetAt: null,
      account: null,
    };
    harness.send({ type: 'run.end', runId: first.id, outcome: 'failed', summary: null, failure: full });
    expect(harness.activeRun(taskId).sessionId).toBeNull();
    expect(countContext(harness.activeRun(taskId).prompt)).toBe(1);
  });

  test('a run resumed after a usage limit with no session is told about the project once', () => {
    const { harness, taskId } = inProject();
    const first = harness.activeRun(taskId);
    const limit: RunFailure = {
      class: 'usage_limit',
      message: 'Claude’s usage limit is reached.',
      code: 'rate_limit',
      retryable: true,
      resetAt: harness.state.seq + 60_000,
      account: null,
    };
    harness.send({ type: 'run.end', runId: first.id, outcome: 'failed', summary: null, failure: limit });
    const wait = harness.task(taskId).usageWait;
    harness.advance(120_000);
    harness.send({ type: 'usage_wait.resume', taskId, waitId: wait?.id ?? '' });
    expect(harness.activeRun(taskId).sessionId).toBeNull();
    expect(countContext(harness.activeRun(taskId).prompt)).toBe(1);
  });

  test('a nudge for a run that never got a session is told about the project once', () => {
    const { harness, taskId } = inProject();
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    expect(countContext(harness.activeRun(taskId).prompt)).toBe(1);
  });
});

describe('links to the chat', () => {
  test('a failure gate points at the run that stopped, and its activity links there too', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: 'Overloaded',
    });
    const second = harness.activeRun(taskId);
    harness.send({ type: 'run.end', runId: second.id, outcome: 'failed', summary: 'Overloaded' });
    const gate = harness.openGate(taskId);
    expect(gate.runId).toBe(second.id);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ kind: 'failure', runId: second.id });
  });

  test('phase summaries and review results link to the run that wrote them', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    const builder = harness.activeRun(taskId);
    completePhase(harness, taskId, 'Found it.');
    const entry = harness.task(taskId).activity.find((item) => item.detail === 'Found it.');
    expect(entry?.runId).toBe(builder.id);
    expect(harness.task(taskId).phaseReports[0]?.runId).toBe(builder.id);
  });
});

function failure(overrides: Partial<RunFailure> = {}): RunFailure {
  return {
    class: 'provider_error',
    message: 'Claude stopped: the model returned an error.',
    code: null,
    retryable: null,
    resetAt: null,
    ...overrides,
  };
}

function attempt(harness: Harness, runId: string, attemptId: string, provider = 'claude') {
  harness.send({
    type: 'run.attempt',
    runId,
    attemptId,
    provider,
    model: 'opus',
    resumed: false,
    handoff: null,
  });
}

describe('run attempts', () => {
  test('each attempt is recorded as a turn with its provider, and the latest one is current', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    attempt(harness, run.id, 'a1');
    harness.send({
      type: 'run.attempt',
      runId: run.id,
      attemptId: 'a2',
      provider: 'codex',
      model: null,
      resumed: false,
      handoff: {
        reason: 'provider_switch',
        fromProvider: 'claude',
        totalEntries: 4,
        includedEntries: 4,
        approxTokens: 90,
      },
    });
    attempt(harness, run.id, 'a2');
    const current = harness.state.runs[run.id];
    expect(current?.attemptId).toBe('a2');
    expect(
      current?.attempts?.map((entry) => [entry.attemptId, entry.provider, entry.handoff?.reason ?? null])
    ).toEqual([
      ['a1', 'claude', null],
      ['a2', 'codex', 'provider_switch'],
    ]);
  });

  test('an attempt on a run that already ended records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'task.cancel', taskId });
    expect(
      harness.send({
        type: 'run.attempt',
        runId: run.id,
        attemptId: 'a1',
        provider: 'claude',
        model: null,
        resumed: false,
        handoff: null,
      }).events
    ).toEqual([]);
    expect(
      harness.send({
        type: 'run.attempt',
        runId: 'missing',
        attemptId: 'a1',
        provider: 'claude',
        model: null,
        resumed: false,
        handoff: null,
      }).events
    ).toEqual([]);
  });

  test('a late end or link from an earlier attempt is ignored; the current attempt still ends the run', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    attempt(harness, run.id, 'a1');
    attempt(harness, run.id, 'a2');
    expect(
      harness.send({ type: 'run.end', runId: run.id, outcome: 'failed', summary: 'late', attemptId: 'a1' })
        .events
    ).toEqual([]);
    expect(
      harness.send({ type: 'run.link', runId: run.id, sessionId: 'old', attemptId: 'a1', provider: 'claude' })
        .events
    ).toEqual([]);
    expect(harness.activeRun(taskId).id).toBe(run.id);
    harness.send({ type: 'run.link', runId: run.id, sessionId: 'new', attemptId: 'a2', provider: 'claude' });
    expect(harness.state.runs[run.id]).toMatchObject({ sessionId: 'new', sessionProvider: 'claude' });
    harness.send({ type: 'run.end', runId: run.id, outcome: 'completed', summary: null, attemptId: 'a2' });
    expect(harness.state.runs[run.id]?.endedAt).not.toBeNull();
  });

  test('a hand-over from an earlier attempt is refused with a message telling the agent to stop', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    attempt(harness, run.id, 'a1');
    attempt(harness, run.id, 'a2');
    expect(() => harness.send({ type: 'agent.note', runId: run.id, note: 'Late.', attemptId: 'a1' })).toThrow(
      'A newer attempt of this step has taken over. End your turn.'
    );
    harness.send({ type: 'agent.note', runId: run.id, note: 'Current.', attemptId: 'a2' });
    harness.send({ type: 'agent.note', runId: run.id, note: 'Unscoped.' });
    expect(harness.task(taskId).note).toBe('Unscoped.');
    expect(() => harness.send({ type: 'agent.note', runId: 'missing', note: 'x', attemptId: 'a1' })).toThrow(
      'No run missing'
    );
  });
});

describe('failure classes', () => {
  test('with auto-resume and snooze off, a usage limit pauses the task at once with the reason, keeping the recovery budget', () => {
    const harness = createHarness();
    harness.send({ type: 'settings.change', patch: { autoResume: false, snoozeLimited: false } });
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    const limit = failure({
      class: 'usage_limit',
      message: 'Claude’s usage limit is reached. It resets at 14:00.',
      resetAt: 5_000,
      retryable: true,
    });
    harness.send({
      type: 'run.end',
      runId: run.id,
      outcome: 'failed',
      summary: limit.message,
      failure: limit,
    });
    expect(harness.state.runs[run.id]?.failure).toEqual(limit);
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', title: 'The agent hit its usage limit', runId: run.id });
    expect(gate.body).toBe(
      'Claude’s usage limit is reached. It resets at 14:00. Retry starts the step again.'
    );
    expect(harness.task(taskId).recoveries).toBe(0);
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('a signed-out agent and an agent that cannot start pause the task too', () => {
    for (const [failureClass, title] of [
      ['auth', 'The agent needs you to sign in'],
      ['setup_failed', 'The agent could not start'],
    ] as const) {
      const harness = createHarness();
      const taskId = createTask(harness);
      const reason = failure({ class: failureClass, message: 'Sign in.' });
      harness.send({
        type: 'run.end',
        runId: harness.activeRun(taskId).id,
        outcome: 'failed',
        summary: null,
        failure: reason,
      });
      expect(harness.openGate(taskId).title).toBe(title);
    }
  });

  test('a full context window or a bad image starts a fresh session that is told to look at the worktree', () => {
    for (const failureClass of ['context_window_full', 'image_error', 'session_lost'] as const) {
      const harness = createHarness();
      const taskId = createTask(harness);
      linkSession(harness, taskId, 'plan-1');
      const first = harness.activeRun(taskId);
      const reason = failure({ class: failureClass, message: 'Claude stopped: the prompt is too long.' });
      harness.send({ type: 'run.end', runId: first.id, outcome: 'failed', summary: null, failure: reason });
      const second = harness.activeRun(taskId);
      expect(second.sessionId).toBeNull();
      expect(second.resume).toBe(false);
      expect(second.prompt).toContain('so this is a fresh session in the same worktree');
      expect(second.prompt).toContain('Claude stopped: the prompt is too long.');
      expect(harness.task(taskId).recoveries).toBe(1);
    }
  });

  test('an overloaded provider resumes the same session with the reason in the nudge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'plan-1');
    const reason = failure({
      class: 'overloaded',
      message: 'Claude API is overloaded (529). Try again shortly.',
    });
    harness.send({
      type: 'run.end',
      runId: harness.activeRun(taskId).id,
      outcome: 'failed',
      summary: null,
      failure: reason,
    });
    const second = harness.activeRun(taskId);
    expect(second.sessionId).toBe('plan-1');
    expect(second.prompt).toContain('(Claude API is overloaded (529). Try again shortly.)');
  });
});

describe('restart continuation', () => {
  test('a shutdown marks a running agent once; boot continues it and clears the mark first', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    attempt(harness, run.id, 'a1');
    harness.send({ type: 'run.interrupt', runId: run.id, attemptId: 'a1' });
    expect(harness.state.runs[run.id]?.resumePending).toBe(true);
    expect(harness.send({ type: 'run.interrupt', runId: run.id }).events).toEqual([]);
    const events = harness.send({ type: 'run.continue', runId: run.id }).events;
    expect(events).toEqual([{ type: 'run.continued', runId: run.id, reason: 'shutdown' }]);
    expect(harness.state.runs[run.id]).toMatchObject({ resumePending: false, endedAt: null });
    expect(harness.state.runs[run.id]?.continuations).toHaveLength(1);
  });

  test('a run that was never marked continues as a crash and spends the recovery budget', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    const events = harness.send({ type: 'run.continue', runId: run.id }).events;
    expect(events).toContainEqual({ type: 'run.continued', runId: run.id, reason: 'crash' });
    expect(harness.task(taskId).recoveries).toBe(1);
    expect(harness.activeRun(taskId).id).toBe(run.id);
  });

  test('a second crash without progress opens the failure gate instead of resuming again', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'run.continue', runId: run.id });
    harness.advance(10 * 60 * 1000);
    harness.send({ type: 'run.continue', runId: run.id });
    expect(harness.state.runs[run.id]?.failure).toMatchObject({ class: 'aborted', code: 'crash_loop' });
    const gate = harness.openGate(taskId);
    expect(gate).toMatchObject({ type: 'failure', title: 'The agent paused' });
    expect(gate.body).toContain('Shinsa stopped unexpectedly while this step ran');
    expect(listActiveRuns(harness.state, taskId)).toHaveLength(0);
  });

  test('progress since a crash buys the next crash another continuation', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'run.continue', runId: harness.activeRun(taskId).id });
    proposePlan(harness, taskId);
    expect(harness.task(taskId).recoveries).toBe(0);
    const builder = harness.activeRun(taskId);
    expect(harness.send({ type: 'run.continue', runId: builder.id }).events).toContainEqual({
      type: 'run.continued',
      runId: builder.id,
      reason: 'crash',
    });
    expect(harness.activeRun(taskId).id).toBe(builder.id);
  });

  test('a shutdown continuation is free: it never spends the recovery budget', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    for (let index = 0; index < 3; index += 1) {
      harness.send({ type: 'run.interrupt', runId: run.id });
      harness.send({ type: 'run.continue', runId: run.id });
      harness.advance(5 * 60 * 1000);
    }
    expect(harness.task(taskId).recoveries).toBe(0);
    expect(harness.activeRun(taskId).id).toBe(run.id);
  });

  test('the fourth restart within five minutes stops resuming and hands the step to bounded recovery', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'plan-1');
    const run = harness.activeRun(taskId);
    for (let index = 0; index < 4; index += 1) {
      harness.send({ type: 'run.interrupt', runId: run.id });
      harness.send({ type: 'run.continue', runId: run.id });
    }
    expect(harness.state.runs[run.id]).toMatchObject({ outcome: 'failed' });
    expect(harness.state.runs[run.id]?.failure).toMatchObject({ class: 'aborted', code: 'restart_loop' });
    const next = harness.activeRun(taskId);
    expect(next.sessionId).toBe('plan-1');
    expect(next.prompt).toContain('Shinsa restarted 4 times within 5 minutes');
    harness.send({ type: 'run.interrupt', runId: next.id });
    harness.send({ type: 'run.continue', runId: next.id });
    expect(harness.activeRun(taskId).id).toBe(next.id);
  });

  test('restarts older than five minutes do not count towards the loop guard', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    const restart = () => {
      harness.send({ type: 'run.interrupt', runId: run.id });
      return harness.send({ type: 'run.continue', runId: run.id }).events;
    };
    for (let index = 0; index < 3; index += 1) restart();
    harness.advance(5 * 60 * 1000);
    expect(restart()).toEqual([{ type: 'run.continued', runId: run.id, reason: 'shutdown' }]);
  });

  test('a run waiting on an answer is neither marked nor continued; the answer restarts it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    harness.send({ type: 'agent.ask', runId: run.id, gateId: 'q1', question: 'Which?', context: null });
    expect(harness.send({ type: 'run.interrupt', runId: run.id }).events).toEqual([]);
    expect(harness.send({ type: 'run.continue', runId: run.id }).events).toEqual([]);
  });

  test('an ended, queued, stale or unknown run is not marked or continued', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    attempt(harness, run.id, 'a2');
    expect(harness.send({ type: 'run.interrupt', runId: run.id, attemptId: 'a1' }).events).toEqual([]);
    expect(harness.send({ type: 'run.interrupt', runId: 'missing' }).events).toEqual([]);
    expect(harness.send({ type: 'run.continue', runId: 'missing' }).events).toEqual([]);
    harness.send({ type: 'task.cancel', taskId });
    expect(harness.send({ type: 'run.interrupt', runId: run.id }).events).toEqual([]);
    expect(harness.send({ type: 'run.continue', runId: run.id }).events).toEqual([]);
  });
});

describe('lost sessions', () => {
  test('a lost session is never resumed again: recovery inherits the mark until a new session links', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    linkSession(harness, taskId, 'plan-1');
    const first = harness.activeRun(taskId);
    harness.send({ type: 'run.record_lost_session', runId: first.id, sessionId: 'plan-1' });
    expect(harness.state.runs[first.id]?.sessionLost).toBe(true);
    expect(
      harness.send({ type: 'run.record_lost_session', runId: first.id, sessionId: 'plan-1' }).events
    ).toEqual([]);
    harness.send({ type: 'run.end', runId: first.id, outcome: 'completed', summary: null });
    const second = harness.activeRun(taskId);
    expect(second).toMatchObject({ sessionId: 'plan-1', sessionLost: true, sessionProvider: 'claude' });
    harness.send({ type: 'run.link', runId: second.id, sessionId: 'plan-2', provider: 'claude' });
    expect(harness.state.runs[second.id]).toMatchObject({ sessionId: 'plan-2', sessionLost: false });
  });

  test('a session no run knows, or an unknown run, records nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    expect(
      harness.send({ type: 'run.record_lost_session', runId: run.id, sessionId: 'nope' }).events
    ).toEqual([]);
    expect(
      harness.send({ type: 'run.record_lost_session', runId: 'missing', sessionId: 'nope' }).events
    ).toEqual([]);
  });
});
