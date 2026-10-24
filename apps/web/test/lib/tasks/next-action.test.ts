import { describe, expect, it } from 'bun:test';
import type { Gate, Run, Task } from '@shinsa/core';
import { describeWaited, resolveTaskAction, resolveTaskSince } from '@/lib/tasks/next-action.ts';
import { createGate, createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

const MINUTE = 60_000;

function setup(gate?: Partial<Gate>, runs: Partial<Run>[] = [], task: Partial<Task> = {}) {
  const subject = createTask({ id: 't', ...task });
  return {
    task: subject,
    state: createShinsaState({
      tasks: [subject],
      gates: gate ? [createGate({ id: 'g', taskId: 't', ...gate })] : [],
      runs: runs.map((run, index) => createRun({ id: `r${index}`, taskId: 't', ...run })),
    }),
  };
}

function actionFor(gate?: Partial<Gate>, runs: Partial<Run>[] = []) {
  const { state, task } = setup(gate, runs);
  return resolveTaskAction(state, task);
}

describe('resolveTaskAction', () => {
  it('opens the code tab for changes to review', () => {
    expect(actionFor({ kind: 'review' })).toEqual({ label: 'Review changes', path: '/tasks/t?tab=code' });
  });

  it('opens the task for a plan or a merge', () => {
    expect(actionFor({ kind: 'spec' })).toEqual({ label: 'Review plan', path: '/tasks/t' });
    expect(actionFor({ kind: 'merge' })).toEqual({ label: 'Review and merge', path: '/tasks/t' });
  });

  it('opens the task to decide on a proposed change, where the proposal is', () => {
    expect(actionFor({ kind: 'question', purpose: 'change', runId: 'run-1' })).toEqual({
      label: 'Decide on the change',
      path: '/tasks/t',
    });
  });

  it('opens the task to confirm an operation after the merge', () => {
    expect(actionFor({ kind: 'question', purpose: 'operation', runId: null })).toEqual({
      label: 'Confirm the operation',
      path: '/tasks/t',
    });
  });

  it('opens the asking run in the chat for a question', () => {
    expect(actionFor({ kind: 'question', runId: 'run-1' })).toEqual({
      label: 'Answer',
      path: '/tasks/t?tab=chat&run=run-1',
    });
  });

  it('opens the task for a question no run asked', () => {
    expect(actionFor({ kind: 'question' })).toEqual({ label: 'Answer', path: '/tasks/t' });
  });

  it('asks you to decide what to do with paused work', () => {
    expect(actionFor({ purpose: 'failure', runId: 'run-1' })).toEqual({
      label: 'Decide what to do',
      path: '/tasks/t',
    });
  });

  it('asks you to fix the setup, not to answer a question, and opens the overview where the checks are', () => {
    expect(actionFor({ kind: 'question', purpose: 'configuration', runId: null })).toEqual({
      label: 'Fix the setup',
      path: '/tasks/t',
    });
  });

  it('asks for a secret by its name on the overview, where the field to paste it is', () => {
    expect(
      actionFor({
        kind: 'question',
        purpose: 'agent_question',
        runId: 'run-1',
        secret: { label: 'GitHub token' },
      })
    ).toEqual({ label: 'Give the GitHub token', path: '/tasks/t' });
  });

  it('asks you to sign in when an account is signed out', () => {
    expect(actionFor({ kind: 'question', purpose: 'sign_in', runId: 'run-1' })).toEqual({
      label: 'Sign in',
      path: '/tasks/t',
    });
  });

  it('follows a running agent in the chat', () => {
    expect(actionFor(undefined, [{ endedAt: NOW - 1000 }, { id: 'live' }])).toEqual({
      label: 'Follow the agent',
      path: '/tasks/t?tab=chat&run=live',
    });
  });

  it('just opens the task when nothing runs and nothing is asked', () => {
    expect(actionFor(undefined, [{ status: 'queued' }])).toEqual({ label: 'Open task', path: '/tasks/t' });
  });
});

describe('resolveTaskSince', () => {
  it('counts from when the gate opened, or else from when the step started', () => {
    const gated = setup({ openedAt: NOW - 3 * MINUTE });
    expect(resolveTaskSince(gated.state, gated.task)).toBe(NOW - 3 * MINUTE);
    const working = setup(undefined, [], { stageChangedAt: NOW - 7 * MINUTE });
    expect(resolveTaskSince(working.state, working.task)).toBe(NOW - 7 * MINUTE);
  });
});

describe('describeWaited', () => {
  it('says how long a decision has waited on you', () => {
    const { state, task } = setup({ openedAt: NOW - 5 * MINUTE });
    expect(describeWaited(state, task, NOW)).toBe('Waiting for 5 minutes');
  });

  it('says a decision opened just now before a minute has passed', () => {
    const { state, task } = setup({ openedAt: NOW - 10_000 });
    expect(describeWaited(state, task, NOW)).toBe('Opened just now');
  });

  it('says when the current step started for work without a decision', () => {
    const { state, task } = setup(undefined, [], { stageChangedAt: NOW - 2 * 60 * MINUTE });
    expect(describeWaited(state, task, NOW)).toBe('Started 2h ago');
    const fresh = setup(undefined, [], { stageChangedAt: Date.now() });
    expect(describeWaited(fresh.state, fresh.task)).toBe('Started just now');
  });
});
