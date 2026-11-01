import { describe, expect, it } from 'bun:test';
import type { DisplayPhase } from '@shinsa/core';
import {
  describeAgentReviewFact,
  describeFollowUpNote,
  describeResultTitle,
  isAgentWorking,
  isTaskWatchable,
  listFeedLines,
  RESULT_TITLE,
  resolveLatestActivity,
  resolveNowKind,
  resolveNowTitle,
  resolveResultPlace,
} from '@/lib/overview/now.ts';
import { describeMentionText } from '@/lib/remote/users.ts';
import { createAgentEntry, createBrief, createCallEntry, createResultEntry } from '../../support/chat.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

const KAI = { login: 'kai', name: 'Kai Lane', avatarUrl: null };

const KAI_OWNER = { name: 'Kai', user: KAI };

const UNKNOWN_OWNER = { name: 'The owner', user: null };

function phase(overrides: Partial<DisplayPhase>): DisplayPhase {
  return { key: 'build', title: 'Build', detail: null, status: 'active', planned: false, ...overrides };
}

describe('resolveNowTitle', () => {
  it('says what a ready bundle task waits for, unless an agent works on it', () => {
    const task = createTask({ id: 't', stage: 'shipping', stageReason: 'ready, merges with its bundle' });
    const wait = 'Merges with its bundle once “Add the screen” is ready';
    expect(resolveNowTitle(task, [], null, undefined, wait)).toBe(wait);
    expect(resolveNowTitle(task, [], null, createRun({ id: 'r', taskId: 't' }), wait)).toBe(
      'Ready, merges with its bundle'
    );
  });

  it('leaves a finished result to its own card and names the settled stage instead', () => {
    const task = createTask({
      id: 't',
      stage: 'done',
      result: { step: 'answer', body: 'Body.', runId: null, at: 0 },
    });
    expect(resolveNowTitle(task, [], null, undefined)).toBe('Marked done.');
    expect(RESULT_TITLE).toEqual({
      answer: 'Answered your question',
      investigate: 'Reported the diagnosis',
      research: 'Wrote the report',
      operate: 'Reported the outcome',
    });
  });

  it('says what the task waits on first', () => {
    const task = createTask({ id: 'task-1', stage: 'waiting_on_tasks' });
    const base = createTask({ id: 'task-0', title: 'Add the export API' });
    expect(resolveNowTitle(task, [base], phase({}), undefined)).toBe('Waits on “Add the export API”');
  });

  it('names the planned phase being built', () => {
    const task = createTask({ id: 'task-1' });
    const current = phase({ key: 'plan-1', title: 'Wire the retry button', planned: true });
    expect(resolveNowTitle(task, [], current, undefined)).toBe('Wire the retry button');
  });

  it('names the checks run between phases rather than the next phase, so it never looks stuck', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'checking',
      stageReason: 'running the checks for phase 1 of 3',
    });
    const next = phase({ key: 'plan-1', title: 'Wire the retry button', planned: true });
    expect(resolveNowTitle(task, [], next, undefined)).toBe('Running the checks for phase 1 of 3');
  });

  it('says a settled task is settled when nothing is running', () => {
    expect(resolveNowTitle(createTask({ id: 'a', stage: 'merged' }), [], null, undefined)).toBe(
      'Merged. Nothing left to do.'
    );
    expect(resolveNowTitle(createTask({ id: 'b', stage: 'done' }), [], null, undefined)).toBe('Marked done.');
    expect(resolveNowTitle(createTask({ id: 'c', stage: 'cancelled' }), [], null, undefined)).toBe(
      'Cancelled.'
    );
  });

  it('names the step a cancelled task stopped at and why', () => {
    const closed = createTask({
      id: 'closed',
      repoId: 'repo-1',
      stage: 'cancelled',
      cancelledFrom: 'awaiting_merge',
      stageReason: 'pull request closed',
    });
    expect(resolveNowTitle(closed, [], null, undefined)).toEqual([
      'Cancelled at Merge: ',
      'the pull request was closed without merging',
      '.',
    ]);
    const yours = { ...closed, cancelledFrom: 'planning' as const, stageReason: 'cancelled by you' };
    expect(resolveNowTitle(yours, [], null, undefined)).toEqual([
      'Cancelled at Plan: ',
      'you',
      ' cancelled the task',
      '.',
    ]);
    expect(resolveNowTitle(yours, [], null, undefined, null, KAI_OWNER)).toEqual([
      'Cancelled at Plan: ',
      { user: KAI, label: 'Kai' },
      ' cancelled the task',
      '.',
    ]);
    const unknown = resolveNowTitle(yours, [], null, undefined, null, UNKNOWN_OWNER);
    expect(describeMentionText(typeof unknown === 'string' ? [unknown] : unknown)).toBe(
      'Cancelled at Plan: the owner cancelled the task.'
    );
    const failed = { ...closed, stageReason: 'cancelled after a failure' };
    expect(resolveNowTitle(failed, [], null, undefined)).toEqual([
      'Cancelled at Merge: ',
      'cancelled after a failure',
      '.',
    ]);
    const original = {
      teamId: 'team',
      machineId: 'm',
      taskId: 'k12',
      handle: 'KAI-12',
      title: 'Dark mode',
      owner: KAI,
    };
    const duplicated = {
      ...closed,
      stageReason: 'duplicate of Kai’s KAI-12 “Dark mode”',
      duplicate: { of: 'k12', by: 'shinsa' as const, why: null, teammate: original },
    };
    expect(resolveNowTitle(duplicated, [], null, undefined)).toEqual([
      'Cancelled at Merge: ',
      'duplicate of ',
      { user: KAI },
      '’s KAI-12 “Dark mode”',
      '.',
    ]);
    const unnamed = {
      ...duplicated,
      duplicate: { ...duplicated.duplicate, teammate: { ...original, owner: null } },
    };
    expect(resolveNowTitle(unnamed, [], null, undefined)).toEqual([
      'Cancelled at Merge: ',
      'duplicate of Kai’s KAI-12 “Dark mode”',
      '.',
    ]);
    const silent = { ...closed, stageReason: '' };
    expect(resolveNowTitle(silent, [], null, undefined)).toBe('Cancelled at Merge.');
  });

  it('falls back to the stage reason, capitalised', () => {
    const task = createTask({ id: 'task-1', stage: 'shipping', stageReason: 'waiting for CI' });
    expect(resolveNowTitle(task, [], phase({ key: 'pull-request' }), undefined)).toBe('Waiting for CI');
  });

  it('names the conflict instead of CI while a pull request conflicts and no fix runs', () => {
    const task = createTask({
      id: 'task-1',
      stage: 'shipping',
      stageReason: 'waiting for CI',
      pullRequest: createPullRequest({ number: 7, mergeable: false, base: 'main' }),
    });
    expect(resolveNowTitle(task, [], phase({ key: 'pull-request' }), undefined)).toBe(
      'PR #7 conflicts with main'
    );
    const fixing = createTask({
      id: 'task-1',
      stage: 'fixing',
      fixFor: 'conflict',
      stageReason: 'resolving conflicts with main',
    });
    expect(resolveNowTitle(fixing, [], phase({ key: 'pull-request' }), undefined)).toBe(
      'Resolving conflicts with main'
    );
  });

  it('uses the stage reason for a settled task while a run is still going', () => {
    const task = createTask({ id: 'task-1', stage: 'merged', stageReason: 'cleaning up' });
    expect(resolveNowTitle(task, [], null, createRun({ id: 'run-1', taskId: 'task-1' }))).toBe('Cleaning up');
  });
});

describe('describeAgentReviewFact', () => {
  it('says the agent review found nothing, and nothing when its findings show below', () => {
    const findings = [
      { severity: 'optional' as const, file: null, line: null, message: 'Consider a guard.' },
    ];
    expect(describeAgentReviewFact(createTask({ id: 'task-1', findings }))).toBeNull();
    expect(describeAgentReviewFact(createTask({ id: 'task-1' }))).toBe('Agent review found nothing');
  });
});

describe('isAgentWorking', () => {
  it('is true while an agent stage runs and no gate waits on you', () => {
    const task = createTask({ id: 'task-1', stage: 'building' });
    expect(isAgentWorking(createShinsaState({ tasks: [task] }), task)).toBe(true);
    const gate = createGate({ id: 'g', taskId: 'task-1' });
    expect(isAgentWorking(createShinsaState({ tasks: [task], gates: [gate] }), task)).toBe(false);
    const merged = createTask({ id: 'task-2', stage: 'merged' });
    expect(isAgentWorking(createShinsaState({ tasks: [merged] }), merged)).toBe(false);
  });
});

describe('isTaskWatchable', () => {
  it('offers to watch a task that is doing something, not one that rests', () => {
    const building = createTask({ id: 'task-1', stage: 'building' });
    expect(isTaskWatchable(createShinsaState({ tasks: [building] }), building)).toBe(true);
    const done = createTask({ id: 'task-2', stage: 'done' });
    expect(isTaskWatchable(createShinsaState({ tasks: [done] }), done)).toBe(false);
  });

  it('still offers to watch a task whose agent is paused, though its status is grey', () => {
    const paused = createTask({
      id: 'task-3',
      stage: 'building',
      monitor: {
        id: 'm',
        runId: 'r',
        role: 'agent',
        phaseIndex: 0,
        notes: 'n',
        armedAt: 0,
        nextCheckAt: 1,
        timeoutAt: 2,
        attempts: 0,
        maxAttempts: 1,
        status: 'armed',
      },
    });
    expect(isTaskWatchable(createShinsaState({ tasks: [paused] }), paused)).toBe(true);
  });
});

describe('listFeedLines', () => {
  it('lists agent messages and tool calls, nothing else', () => {
    const lines = listFeedLines(
      [
        createBrief('Build the change.', undefined, 'brief'),
        createAgentEntry('Reading the export code.\nThen the tests.', 'interim', undefined, 'agent'),
        createCallEntry(
          'call-1',
          { kind: 'command', action: 'run', command: 'bun test', description: null },
          undefined,
          'call'
        ),
        createResultEntry('call-1', 'ok'),
      ],
      5
    );
    expect(lines).toEqual([
      { key: 'agent', icon: 'IconBubbleText', label: null, text: 'Reading the export code.' },
      { key: 'call', icon: 'IconConsole', label: 'Running', text: 'bun test' },
    ]);
  });

  it('gives a tool without a target an empty line', () => {
    const lines = listFeedLines(
      [createCallEntry('call-1', { kind: 'command', action: 'stop', command: 'bun dev', description: null })],
      5
    );
    expect(lines.map((line) => [line.label, line.text])).toEqual([['Stopping a command', '']]);
  });

  it('names only the latest tool call in the present tense, the way the chat’s live line does', () => {
    const lines = listFeedLines(
      [
        createCallEntry('call-1', { kind: 'read', path: 'a.ts', range: null }, undefined, 'first'),
        createResultEntry('call-1', 'ok'),
        createCallEntry('call-2', { kind: 'read', path: 'b.ts', range: null }, undefined, 'second'),
        createResultEntry('call-2', 'ok'),
      ],
      5
    );
    expect(lines.map((line) => [line.label, line.text])).toEqual([
      ['Read', 'a.ts'],
      ['Reading', 'b.ts'],
    ]);
  });

  it('keeps only the latest lines', () => {
    const entries = ['one', 'two', 'three'].map((text) => createAgentEntry(text, 'interim'));
    expect(listFeedLines(entries, 2).map((line) => line.text)).toEqual(['two', 'three']);
    expect(listFeedLines([], 2)).toEqual([]);
  });
});

describe('resolveLatestActivity', () => {
  it('names the newest tool call in the present tense with its target', () => {
    const entries = [
      createAgentEntry('Reading the export code.', 'interim'),
      createCallEntry('call-1', {
        kind: 'command',
        action: 'run',
        command: 'bun test apps/web',
        description: null,
      }),
    ];
    expect(resolveLatestActivity(entries)).toBe('Running bun test apps/web');
  });

  it('gives the first line of the newest agent message, or the verb alone for a tool without a target', () => {
    expect(resolveLatestActivity([createAgentEntry('Wiring the form.\nThen the tests.', 'interim')])).toBe(
      'Wiring the form.'
    );
    expect(
      resolveLatestActivity([
        createCallEntry('call-1', { kind: 'command', action: 'stop', command: 'bun dev', description: null }),
      ])
    ).toBe('Stopping a command');
  });

  it('is null before the run has done anything', () => {
    expect(resolveLatestActivity([])).toBeNull();
    expect(resolveLatestActivity([createBrief('Build the change.')])).toBeNull();
  });
});

describe('what the now card shows', () => {
  const RESULT = { step: 'answer' as const, body: 'Yes.', runId: null, at: 0 };

  it('shows a gate first, then the work of a running agent, then a wait, then a finished result', () => {
    const done = createTask({ id: 't', stage: 'done', result: RESULT });
    const state = createShinsaState({ tasks: [done] });
    const gate = createGate({ id: 'g', taskId: 't', type: 'question' });
    expect(resolveNowKind(state, done, gate)).toBe('gate');
    expect(resolveNowKind(state, done, undefined)).toBe('result');
    const running = createShinsaState({ tasks: [done], runs: [createRun({ id: 'r', taskId: 't' })] });
    expect(resolveNowKind(running, done, undefined)).toBe('work');
    const usage = createTask({
      id: 't',
      stage: 'answering',
      usageWait: { status: 'armed' } as never,
    });
    expect(resolveNowKind(state, usage, undefined)).toBe('usage_wait');
    const monitor = createTask({ id: 't', stage: 'building', monitor: { status: 'armed' } as never });
    expect(resolveNowKind(state, monitor, undefined)).toBe('wait');
    const postMerge = createGate({ id: 'a', taskId: 't', type: 'post_merge' });
    expect(resolveNowKind(state, done, postMerge)).toBe('gate');
    expect(resolveNowKind(running, done, postMerge)).toBe('work');
    expect(resolveNowKind(state, createTask({ id: 't', stage: 'done' }), undefined)).toBe('work');
  });

  it('puts the result in the now card when it is finished or waits for your OK, and leaves it to its panel otherwise', () => {
    const state = createShinsaState({});
    const done = createTask({ id: 't', stage: 'done', result: RESULT });
    expect(resolveResultPlace(state, done, undefined)).toBe('now_card');
    expect(resolveResultPlace(state, done, createGate({ id: 'g', taskId: 't', type: 'proposal' }))).toBe(
      'now_card'
    );
    const answered = createTask({ id: 't', stage: 'answered', result: RESULT });
    expect(resolveResultPlace(state, answered, createGate({ id: 'g', taskId: 't', type: 'result' }))).toBe(
      'now_card'
    );
    expect(resolveResultPlace(state, done, createGate({ id: 'g', taskId: 't', type: 'question' }))).toBe(
      'panel'
    );
    expect(
      resolveResultPlace(state, createTask({ id: 't', stage: 'building', result: RESULT }), undefined)
    ).toBe('panel');
    expect(resolveResultPlace(state, createTask({ id: 't', stage: 'done' }), undefined)).toBe('hidden');
  });

  it('hides a result while an agent delivers the next one, since its hand-over replaces it', () => {
    const report = { ...RESULT, step: 'research' as const };
    const followUp = createTask({ id: 't', stage: 'researching', result: report });
    const state = createShinsaState({ tasks: [followUp], runs: [createRun({ id: 'r', taskId: 't' })] });
    expect(resolveResultPlace(state, followUp, undefined)).toBe('hidden');
    expect(resolveResultPlace(state, followUp, createGate({ id: 'g', taskId: 't', type: 'question' }))).toBe(
      'hidden'
    );
    const answering = createTask({ id: 't', stage: 'answering', result: report });
    expect(resolveResultPlace(state, answering, undefined)).toBe('hidden');
    const building = createTask({ id: 't', stage: 'building', result: { ...RESULT, step: 'investigate' } });
    expect(resolveResultPlace(state, building, undefined)).toBe('panel');
  });

  it('says who answers a follow-up, and that an operation takes the next piece of work instead', () => {
    expect(describeFollowUpNote('answer', 'answerer')).toBe(
      'Ask a follow-up in the chat and the answerer answers in the same conversation.'
    );
    expect(describeFollowUpNote('research', null)).toBe(
      'Ask a follow-up in the chat and the agent answers in the same conversation.'
    );
    expect(describeFollowUpNote('operate', 'agent')).toBe(
      'Ask a follow-up or for more work in the chat. The agent answers a follow-up; more work starts a new round.'
    );
  });
});

describe('describeResultTitle', () => {
  it('names the owner whose question was answered, and leaves the other steps alone', () => {
    expect(describeResultTitle('answer')).toBe('Answered your question');
    expect(describeResultTitle('answer', KAI_OWNER)).toEqual([
      'Answered ',
      { user: KAI, label: 'Kai’s' },
      ' question',
    ]);
    expect(describeResultTitle('answer', UNKNOWN_OWNER)).toEqual(['Answered ', 'the owner’s', ' question']);
    expect(describeResultTitle('research', KAI_OWNER)).toBe('Wrote the report');
  });
});
