import { describe, expect, it } from 'bun:test';
import type { DelegatedRun, Run, RunDelegation } from '@shinsa/core';
import {
  DELEGATION_OUTCOME,
  type DelegationView,
  describeDelegations,
  describeParkedRun,
  describeReportVerb,
  describeStopDelegation,
  listChatRuns,
  listDelegationPath,
  listDelegationTree,
  listLiveDelegations,
  listRoundDelegationTree,
  resolveDelegationStatusLabel,
  resolveStepRunId,
  selectDelegation,
} from '@/lib/chat/delegations.ts';
import { createRound } from '../../support/rounds.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

function delegation(overrides: Partial<RunDelegation> = {}): RunDelegation {
  return {
    parentRunId: 'step',
    depth: 1,
    requestKey: 'k',
    title: 'Survey the tests',
    brief: 'Survey them.',
    mode: 'async',
    wake: 'always',
    isolation: 'shared',
    baseCommit: null,
    delivery: 'none',
    question: null,
    requestedAt: NOW,
    ...overrides,
  };
}

function delegated(id: string, overrides: Partial<Run> = {}, patch: Partial<RunDelegation> = {}) {
  return createRun({
    id,
    taskId: 't',
    role: 'reviewer',
    status: 'running',
    delegation: delegation(patch),
    ...overrides,
  }) as DelegatedRun;
}

const QUESTION = {
  id: 'q',
  question: 'Which file?',
  context: null,
  choices: [],
  recommendation: null,
  askedAt: NOW,
  delivered: true,
  answer: null,
  answeredAt: null,
};

function stateWith(...runs: Run[]) {
  return createShinsaState({
    tasks: [createTask({ id: 't' })],
    runs: [createRun({ id: 'step', taskId: 't', status: 'running' }), ...runs],
  });
}

function view(run: DelegatedRun): DelegationView {
  const described = selectDelegation(stateWith(run), run.id);
  if (!described) throw new Error(`No delegation ${run.id}`);
  return described;
}

describe('a delegated task’s view', () => {
  it('names the delegated task, its role and how far it got', () => {
    const run = delegated('a');
    expect(view(run)).toEqual({
      run,
      title: 'Survey the tests',
      role: 'Reviewer',
      status: 'running',
      live: true,
      question: null,
      result: null,
    });
  });

  it('shows the result once it ends, and an open question only while it waits for the answer', () => {
    const done = delegated('a', { endedAt: NOW, outcome: 'completed', summary: 'Found two.' });
    expect(view(done)).toMatchObject({ status: 'completed', live: false, result: 'Found two.' });
    expect(view(delegated('b', {}, { question: QUESTION }))).toMatchObject({
      status: 'waiting',
      question: 'Which file?',
    });
    expect(view(delegated('c', {}, { question: { ...QUESTION, answer: 'a.ts' } })).question).toBeNull();
  });

  it('marks how it ended, names its report by that, and says what Stop does', () => {
    expect(DELEGATION_OUTCOME).toEqual({ completed: 'pass', failed: 'fail', cancelled: 'skipped' });
    expect(describeReportVerb(view(delegated('a', { endedAt: NOW, outcome: 'completed' })))).toBe(
      'Reported back'
    );
    expect(describeReportVerb(view(delegated('a', { endedAt: NOW, outcome: 'failed' })))).toBe('Failed');
    expect(describeStopDelegation(view(delegated('a')))).toBe(
      'Stop “Survey the tests” and what it delegated'
    );
  });
});

describe('resolveDelegationStatusLabel', () => {
  it('words each status, and a question as asked of the agent, never of you', () => {
    const label = (run: DelegatedRun) => resolveDelegationStatusLabel(view(run));
    expect(label(delegated('a', { status: 'queued' }))).toEqual({
      label: 'Waiting to start',
      tone: 'neutral',
    });
    expect(label(delegated('a'))).toEqual({ label: 'Working', tone: 'blue' });
    expect(label(delegated('a', { status: 'waiting' }))).toEqual({
      label: 'Waiting for its delegated tasks',
      tone: 'blue',
    });
    expect(label(delegated('a', {}, { question: QUESTION }))).toEqual({
      label: 'Waiting for the agent that delegated it to answer',
      tone: 'amber',
    });
    expect(label(delegated('a', { endedAt: NOW, outcome: 'completed' }))).toEqual({
      label: 'Finished',
      tone: 'green',
    });
    expect(label(delegated('a', { endedAt: NOW, outcome: 'failed' }))).toEqual({
      label: 'Failed',
      tone: 'red',
    });
    expect(label(delegated('a', { endedAt: NOW, outcome: 'cancelled' }))).toEqual({
      label: 'Stopped',
      tone: 'neutral',
    });
  });
});

describe('selectDelegation', () => {
  it('describes a delegated run and nothing else', () => {
    const state = stateWith(delegated('a'));
    expect(selectDelegation(state, 'a')?.title).toBe('Survey the tests');
    expect(selectDelegation(state, 'step')).toBeNull();
    expect(selectDelegation(state, 'missing')).toBeNull();
  });
});

describe('listDelegationTree', () => {
  it('lists the task’s delegated work parent first, each child under the one that delegated it', () => {
    const state = stateWith(
      delegated('a', { startedAt: NOW - 3 }),
      delegated('b', { startedAt: NOW - 2 }),
      delegated('a1', { startedAt: NOW - 1 }, { parentRunId: 'a', depth: 2 }),
      delegated('a1x', { startedAt: NOW }, { parentRunId: 'a1', depth: 3 }),
      delegated('other', { taskId: 'u' })
    );
    expect(listDelegationTree(state, 't').map((row) => [row.view.run.id, row.depth])).toEqual([
      ['a', 1],
      ['a1', 2],
      ['a1x', 3],
      ['b', 1],
    ]);
    expect(listDelegationTree(state, 'none')).toEqual([]);
    expect(
      listLiveDelegations(
        stateWith(delegated('a'), delegated('b', { endedAt: NOW, outcome: 'completed' })),
        't'
      ).map((live) => live.run.id)
    ).toEqual(['a']);
  });
});

describe('listRoundDelegationTree', () => {
  it('lists only what the current round’s steps delegated', () => {
    const task = createTask({
      id: 't',
      rounds: [createRound({ number: 1 }), createRound({ number: 2, status: 'active', outcome: null })],
    });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'first', taskId: 't' }),
        createRun({ id: 'second', taskId: 't', round: 2 }),
        delegated('old', {}, { parentRunId: 'first' }),
        delegated('new', {}, { parentRunId: 'second' }),
        delegated('new-child', {}, { parentRunId: 'new', depth: 2 }),
      ],
    });
    expect(listRoundDelegationTree(state, task).map((row) => row.view.run.id)).toEqual(['new', 'new-child']);
  });
});

describe('describeDelegations', () => {
  it('counts what is still working and what is done, or says nothing', () => {
    expect(
      describeDelegations([
        view(delegated('a')),
        view(delegated('b', { endedAt: NOW, outcome: 'completed' })),
      ])
    ).toBe('1 working · 1 done');
    expect(describeDelegations([view(delegated('a'))])).toBe('1 working');
    expect(describeDelegations([view(delegated('b', { endedAt: NOW, outcome: 'failed' }))])).toBe('1 done');
    expect(describeDelegations([])).toBeNull();
  });
});

describe('listChatRuns', () => {
  it('leaves delegated runs out of the task’s conversation, which shows them inside their parent', () => {
    const step = createRun({ id: 'step', taskId: 't' });
    expect(listChatRuns([step, delegated('a')])).toEqual([step]);
  });
});

describe('listDelegationPath', () => {
  it('names a delegated run and every delegated run above it, and nothing for a step', () => {
    const state = stateWith(delegated('a'), delegated('a1', {}, { parentRunId: 'a', depth: 2 }));
    expect([...listDelegationPath(state, 'a1')]).toEqual(['a1', 'a']);
    expect([...listDelegationPath(state, 'step')]).toEqual([]);
    expect([...listDelegationPath(state, 'missing')]).toEqual([]);
    expect([...listDelegationPath(state, null)]).toEqual([]);
  });

  it('stops at a loop instead of walking it forever', () => {
    const state = stateWith(
      delegated('x', {}, { parentRunId: 'y' }),
      delegated('y', {}, { parentRunId: 'x', depth: 2 })
    );
    expect([...listDelegationPath(state, 'x')]).toEqual(['x', 'y']);
  });
});

describe('resolveStepRunId', () => {
  it('finds the step a delegated run hangs under, and keeps any other id as it is', () => {
    const state = stateWith(delegated('a'), delegated('a1', {}, { parentRunId: 'a', depth: 2 }));
    expect(resolveStepRunId(state, 'a1')).toBe('step');
    expect(resolveStepRunId(state, 'step')).toBe('step');
    expect(resolveStepRunId(state, 'missing')).toBe('missing');
    expect(resolveStepRunId(state, null)).toBeNull();
  });
});

describe('describeParkedRun', () => {
  it('says how many delegated tasks a waiting step waits for, and nothing for a working or ended one', () => {
    const waiting = (delegations: string[]) =>
      createRun({
        id: 'step',
        taskId: 't',
        status: 'waiting',
        waitingOn: { delegations, since: NOW, reason: 'x' },
      });
    expect(describeParkedRun(waiting(['a', 'b']))).toEqual({
      label: 'Waiting for 2 delegated tasks',
      tone: 'blue',
    });
    expect(describeParkedRun(waiting(['a']))?.label).toBe('Waiting for 1 delegated task');
    expect(describeParkedRun(createRun({ id: 's', taskId: 't', status: 'waiting' }))?.label).toBe(
      'Waiting for its delegated tasks'
    );
    expect(describeParkedRun(createRun({ id: 's', taskId: 't', status: 'running' }))).toBeNull();
    expect(
      describeParkedRun(createRun({ id: 's', taskId: 't', status: 'waiting', endedAt: NOW }))
    ).toBeNull();
  });

  it('says a delegated agent waits for the agent that delegated it, not for you', () => {
    expect(describeParkedRun(delegated('a', {}, { question: QUESTION }))).toEqual({
      label: 'Waiting for the agent that delegated it to answer',
      tone: 'amber',
    });
    expect(describeParkedRun(delegated('a', {}, { question: { ...QUESTION, answer: 'a.ts' } }))).toBeNull();
  });
});
