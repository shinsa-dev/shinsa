import { describe, expect, it } from 'bun:test';
import type { DisplayPhase, ReportCheck } from '@shinsa/core';
import {
  describeChecksPassed,
  describeReviewFacts,
  hasFailingCheck,
  isAgentWorking,
  isTaskWatchable,
  listFeedLines,
  resolveNowTitle,
} from '@/lib/overview/now.ts';
import { createAgentEntry, createBrief, createCallEntry, createResultEntry } from '../../support/chat.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

function phase(overrides: Partial<DisplayPhase>): DisplayPhase {
  return { key: 'build', title: 'Build', detail: null, status: 'active', planned: false, ...overrides };
}

function check(outcome: ReportCheck['outcome']): ReportCheck {
  return { name: `check ${outcome}`, outcome, detail: null };
}

const PULL_REQUEST = {
  number: 4531,
  url: 'https://github.com/acme/app/pull/4531',
  state: 'open' as const,
  checks: 'passing' as const,
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
};

describe('resolveNowTitle', () => {
  it('says an answered question is answered', () => {
    const task = createTask({ id: 'task-1', stage: 'done', mode: 'ask' });
    expect(resolveNowTitle(task, [], null, undefined)).toBe('Answered. The answer is below.');
  });

  it('points a finished investigation, report or operation at its result', () => {
    for (const [step, title] of [
      ['investigate', 'Finished. The findings are below.'],
      ['research', 'Finished. The report is below.'],
      ['operate', 'Finished. The outcome is below.'],
    ] as const) {
      const task = createTask({
        id: 't',
        stage: 'done',
        result: { step, body: 'Body.', runId: null, at: 0 },
      });
      expect(resolveNowTitle(task, [], null, undefined)).toBe(title);
    }
  });

  it('says what the task waits on first', () => {
    const task = createTask({ id: 'task-1', stage: 'queued' });
    const base = createTask({ id: 'task-0', title: 'Add the export API' });
    expect(resolveNowTitle(task, [base], phase({}), undefined)).toBe('Waits on “Add the export API”');
  });

  it('names the planned phase being built', () => {
    const task = createTask({ id: 'task-1' });
    const current = phase({ key: 'plan-1', title: 'Wire the retry button', planned: true });
    expect(resolveNowTitle(task, [], current, undefined)).toBe('Wire the retry button');
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

  it('falls back to the stage reason, capitalised', () => {
    const task = createTask({ id: 'task-1', stage: 'shipping', stageReason: 'waiting for CI' });
    expect(resolveNowTitle(task, [], phase({ key: 'pull-request' }), undefined)).toBe('Waiting for CI');
  });

  it('uses the stage reason for a settled task while a run is still going', () => {
    const task = createTask({ id: 'task-1', stage: 'merged', stageReason: 'cleaning up' });
    expect(resolveNowTitle(task, [], null, createRun({ id: 'run-1', taskId: 'task-1' }))).toBe('Cleaning up');
  });
});

describe('describeReviewFacts', () => {
  it('sums up checks and the agent review', () => {
    const task = createTask({
      id: 'task-1',
      checkResults: [check('pass'), check('pass'), check('fail')],
      findings: [{ severity: 'suggestion', file: null, line: null, message: 'Consider a guard.' }],
    });
    expect(describeReviewFacts(task, false, null)).toBe('2 of 3 checks passed · agent review left 1 note');
  });

  it('starts with a capital letter when there are no checks', () => {
    expect(describeReviewFacts(createTask({ id: 'task-1' }), false, null)).toBe('Agent review found nothing');
  });

  it('counts several notes', () => {
    const findings = [
      { severity: 'blocking' as const, file: null, line: null, message: 'One' },
      { severity: 'suggestion' as const, file: null, line: null, message: 'Two' },
    ];
    expect(describeReviewFacts(createTask({ id: 'task-1', findings }), false, null)).toBe(
      'Agent review left 2 notes'
    );
  });

  it('says the pull request is clean at the merge gate', () => {
    const task = createTask({ id: 'task-1', checkResults: [check('pass')], pullRequest: PULL_REQUEST });
    expect(describeReviewFacts(task, true, null)).toBe(
      'The check passed · agent review found nothing · PR #4531 is clean'
    );
    expect(describeReviewFacts(task, false, null)).toBe('The check passed · agent review found nothing');
    expect(describeReviewFacts(createTask({ id: 'task-2' }), true, null)).toBe('Agent review found nothing');
  });
});

describe('describeChecksPassed', () => {
  it('says how many checks passed, with a lone check named as one', () => {
    expect(describeChecksPassed([check('pass')])).toBe('The check passed');
    expect(describeChecksPassed([check('fail')])).toBe('The check failed');
    expect(describeChecksPassed([check('pass'), check('pass')])).toBe('All 2 checks passed');
    expect(describeChecksPassed([check('fail'), check('fail')])).toBe('0 of 2 checks passed');
  });

  it('notices a failing check among passing ones', () => {
    expect(hasFailingCheck([check('pass'), check('fail')])).toBe(true);
    expect(hasFailingCheck([check('pass')])).toBe(false);
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
      { key: 'call', icon: 'IconConsole', label: 'Ran', text: 'bun test' },
    ]);
  });

  it('gives a tool without a target an empty line', () => {
    const lines = listFeedLines(
      [createCallEntry('call-1', { kind: 'command', action: 'stop', command: 'bun dev', description: null })],
      5
    );
    expect(lines.map((line) => [line.label, line.text])).toEqual([['Stopped a command', '']]);
  });

  it('keeps only the latest lines', () => {
    const entries = ['one', 'two', 'three'].map((text) => createAgentEntry(text, 'interim'));
    expect(listFeedLines(entries, 2).map((line) => line.text)).toEqual(['two', 'three']);
    expect(listFeedLines([], 2)).toEqual([]);
  });
});
