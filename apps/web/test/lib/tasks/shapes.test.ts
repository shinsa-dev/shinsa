import { describe, expect, it } from 'bun:test';
import type { PipelineStep } from '@shinsa/core';
import {
  describeChangeGate,
  describeSteps,
  describeTaskSteps,
  isCodeTask,
  isShapeChosen,
  RESULT_PANEL,
  resolvePlannedOperation,
  resolveShapeIcon,
  resolveShapeLabel,
  SHAPE_LABEL,
} from '@/lib/tasks/shapes.ts';
import { createGate, createTask } from '../../support/state.ts';

describe('shape labels', () => {
  it('name each kind of task', () => {
    expect(SHAPE_LABEL).toEqual({
      answer: 'Answer only',
      investigate: 'Investigation',
      research: 'Research',
      change: 'Change',
      fix: 'Find and fix',
      operation: 'Operation',
    });
  });

  it('read a task’s kind from its pipeline, an old Ask task as Answer only', () => {
    expect(resolveShapeLabel(createTask({ id: 't', mode: 'ask' }))).toBe('Answer only');
    expect(resolveShapeLabel(createTask({ id: 't' }))).toBe('Change');
    expect(resolveShapeLabel(createTask({ id: 't', pipeline: ['investigate'] }))).toBe('Investigation');
  });

  it('name composed steps by the work they do, in the order they do it', () => {
    const change = [
      'plan',
      'build',
      'checks',
      'agent_review',
      'your_review',
      'pull_request',
      'merge',
    ] as const;
    const label = (pipeline: PipelineStep[]) => resolveShapeLabel(createTask({ id: 't', pipeline }));
    expect(label([...change, 'operate'])).toBe('Change, then operation');
    expect(label(['plan', 'operate', 'build', 'your_review', 'pull_request', 'merge'])).toBe(
      'Operation, then change'
    );
    expect(label(['investigate', 'your_ok', ...change, 'operate'])).toBe(
      'Investigation, then change, then operation'
    );
    expect(label(['research', 'your_ok', 'plan', 'operate'])).toBe('Research, then operation');
    expect(label(['plan', 'build', 'your_review', 'pull_request', 'merge'])).toBe('Change');
  });

  it('title each result by the step that wrote it', () => {
    expect(RESULT_PANEL.investigate.title).toBe('Diagnosis');
    expect(RESULT_PANEL.research.title).toBe('Report');
    expect(RESULT_PANEL.operate.title).toBe('Outcome');
  });
});

const PLAN = {
  goal: 'g',
  phases: [
    { title: 'Write a', detail: 'd' },
    { title: 'Write b', detail: 'd' },
  ],
  behaviour: [],
  approach: 'a',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

describe('describeTaskSteps', () => {
  it('names the kind and every step it takes in order, a plan’s phases as one build', () => {
    expect(
      describeTaskSteps(createTask({ id: 't', repoId: 'r', pipeline: ['answer'], stage: 'answering' }))
    ).toBe('Answer only: find the repository, then answer.');
    expect(describeTaskSteps(createTask({ id: 't', pipeline: ['answer'], stage: 'answering' }))).toBe(
      'Answer only: answer.'
    );
    expect(
      describeTaskSteps(createTask({ id: 't', pipeline: ['investigate'], stage: 'awaiting_proposal' }))
    ).toBe('Investigation: find the repository, investigate, then your OK to change.');
    expect(
      describeTaskSteps(
        createTask({
          id: 't',
          stage: 'building',
          plan: { version: 1, body: '', document: PLAN, proposedAt: 1 },
        })
      )
    ).toBe('Change: plan, build, checks and agent review, your review, pull request, then merge.');
    expect(
      describeTaskSteps(
        createTask({
          id: 't',
          stage: 'planning',
          pipeline: [
            'plan',
            'build',
            'checks',
            'agent_review',
            'your_review',
            'pull_request',
            'merge',
            'operate',
          ],
        })
      )
    ).toBe(
      'Change, then operation: plan, build, checks and agent review, your review, pull request, merge, then run the operation.'
    );
    expect(describeTaskSteps(createTask({ id: 't', pipeline: ['plan', 'operate'], stage: 'planning' }))).toBe(
      'Operation: plan, then run the operation.'
    );
  });
});

describe('isCodeTask', () => {
  it('is true only for kinds that build code', () => {
    expect(isCodeTask(createTask({ id: 't' }))).toBe(true);
    expect(
      isCodeTask(
        createTask({
          id: 't',
          pipeline: [
            'investigate',
            'plan',
            'build',
            'checks',
            'agent_review',
            'your_review',
            'pull_request',
            'merge',
          ],
        })
      )
    ).toBe(true);
    expect(isCodeTask(createTask({ id: 't', pipeline: ['investigate'] }))).toBe(false);
    expect(isCodeTask(createTask({ id: 't', pipeline: ['plan', 'operate'] }))).toBe(false);
  });
});

describe('describeChangeGate', () => {
  it('words the change gate for the inquiry that proposed it, from the open proposal', () => {
    const task = createTask({
      id: 't',
      pipeline: ['investigate'],
      proposal: { request: 'Release the connection.', why: 'It leaks.', status: 'open', runId: null, at: 0 },
    });
    expect(describeChangeGate(task, createGate({ id: 'g', taskId: 't', body: 'ignored' }))).toEqual({
      eyebrow: 'The investigation proposes a fix',
      keep: 'Keep it as an investigation',
      why: 'It leaks.',
      request: 'Release the connection.',
      requestLabel: 'What it would change',
      goOn: {
        label: 'Make it a change',
        reply: 'makeChange',
        note: 'A change gets a plan, then your review before it merges.',
      },
    });
  });

  it('words a proposal the same once the agent added your OK and the change to the steps', () => {
    const proposal = {
      request: 'Release the connection.',
      why: 'It leaks.',
      status: 'open',
      runId: null,
      at: 5,
    } as const;
    const task = createTask({
      id: 't',
      pipeline: ['investigate', 'your_ok', 'plan', 'build', 'merge'],
      proposal,
      shapeChanges: [
        {
          from: ['investigate'],
          to: ['investigate', 'your_ok', 'plan', 'build', 'merge'],
          by: 'agent',
          reason: 'It leaks.',
          at: 5,
        },
      ],
    });
    expect(describeChangeGate(task, createGate({ id: 'g', taskId: 't' }))).toMatchObject({
      eyebrow: 'The investigation proposes a fix',
      requestLabel: 'What it would change',
    });
    const earlier = createTask({
      ...task,
      shapeChanges: [
        {
          from: ['investigate'],
          to: ['investigate', 'your_ok', 'plan', 'build', 'merge'],
          by: 'agent',
          reason: 'Composed.',
          at: 1,
        },
      ],
    });
    expect(describeChangeGate(earlier, createGate({ id: 'g', taskId: 't' }))).toMatchObject({
      eyebrow: 'The diagnosis is in',
      requestLabel: 'What comes next',
    });
  });

  it('falls back to the gate’s body, the why before the request', () => {
    const answer = createTask({ id: 't', pipeline: ['answer'] });
    expect(
      describeChangeGate(answer, createGate({ id: 'g', taskId: 't', body: 'Why.\n\nDo this.\n\nThen that.' }))
    ).toMatchObject({ keep: 'Keep it as an answer', why: 'Why.', request: 'Do this.\n\nThen that.' });
    expect(
      describeChangeGate(
        createTask({ id: 't', pipeline: ['research'] }),
        createGate({ id: 'g', taskId: 't' })
      ).eyebrow
    ).toBe('The report proposes a change');
  });
});

const OPERATION_AFTER_FINDINGS = ['investigate', 'your_ok', 'plan', 'operate'] as const;
const CHANGE_AFTER_RESEARCH = [
  'research',
  'your_ok',
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
] as const;

describe('composed steps', () => {
  it('name a composition by what it starts and ends with, and keep the icon of the work it does', () => {
    const operation = createTask({ id: 't', pipeline: [...OPERATION_AFTER_FINDINGS] });
    expect(resolveShapeLabel(operation)).toBe('Investigation, then operation');
    expect(resolveShapeIcon(operation)).toBe('IconConsole');
    expect(resolveShapeLabel(createTask({ id: 't', pipeline: [...CHANGE_AFTER_RESEARCH] }))).toBe(
      'Research, then change'
    );
    expect(
      resolveShapeLabel(createTask({ id: 't', pipeline: ['answer', 'your_ok', 'plan', 'operate'] }))
    ).toBe('Answer, then operation');
    expect(resolveShapeLabel(createTask({ id: 't', pipeline: ['plan', 'operate'] }))).toBe('Operation');
  });

  it('list the steps in order, with your OK before the plan', () => {
    expect(describeSteps([...OPERATION_AFTER_FINDINGS])).toBe(
      'investigate, your OK, plan, run the operation'
    );
    expect(describeSteps(['plan', 'deploy', 'build'])).toBe('plan, build');
    expect(
      describeTaskSteps(
        createTask({ id: 't', pipeline: [...OPERATION_AFTER_FINDINGS], stage: 'investigating' })
      )
    ).toBe(
      'Investigation, then operation: find the repository, investigate, your OK to run, plan, then run the operation.'
    );
  });

  it('word your OK by what comes next, and plan an operation when that is the next step', () => {
    const task = createTask({ id: 't', pipeline: [...OPERATION_AFTER_FINDINGS], stage: 'awaiting_proposal' });
    expect(
      describeChangeGate(task, createGate({ id: 'g', taskId: 't', body: 'Find it.\n\nPlan it.' }))
    ).toEqual({
      eyebrow: 'The diagnosis is in',
      keep: 'Keep it as an investigation',
      why: 'Find it.',
      request: 'Plan it.',
      requestLabel: 'What comes next',
      goOn: {
        label: 'Plan the operation',
        reply: 'planOperation',
        note: 'An operation gets a plan you approve before anything runs.',
      },
    });
    const research = createTask({ id: 't', pipeline: [...CHANGE_AFTER_RESEARCH] });
    expect(describeChangeGate(research, createGate({ id: 'g', taskId: 't' }))).toMatchObject({
      eyebrow: 'The report is in',
      goOn: { label: 'Make it a change' },
    });
  });
});

describe('resolvePlannedOperation', () => {
  const plan = (operation?: string[]) => ({
    version: 1,
    body: '',
    approvedAt: null,
    document: {
      goal: 'g',
      phases: [],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
      ...(operation ? { operation } : {}),
    },
  });
  it('names when a change’s operation runs and lists its steps', () => {
    const after: PipelineStep[] = ['plan', 'build', 'your_review', 'pull_request', 'merge', 'operate'];
    const before: PipelineStep[] = ['plan', 'operate', 'build', 'your_review', 'pull_request', 'merge'];
    expect(
      resolvePlannedOperation(createTask({ pipeline: after, plan: plan(['Backfill.']) } as never))
    ).toEqual({ heading: 'After the merge, the operation', steps: ['Backfill.'] });
    expect(
      resolvePlannedOperation(createTask({ pipeline: before, plan: plan(['Snapshot.']) } as never))?.heading
    ).toBe('First, the operation');
  });
  it('shows nothing for an operation alone, a change alone or a plan without steps', () => {
    expect(
      resolvePlannedOperation(createTask({ pipeline: ['plan', 'operate'], plan: plan(['Run.']) } as never))
    ).toBeNull();
    expect(
      resolvePlannedOperation(
        createTask({ id: 't1', pipeline: ['plan', 'build', 'your_review', 'pull_request', 'merge'] })
      )
    ).toBeNull();
    expect(
      resolvePlannedOperation(
        createTask({
          pipeline: ['plan', 'build', 'your_review', 'pull_request', 'merge', 'operate'],
          plan: plan(),
        } as never)
      )
    ).toBeNull();
  });
});

describe('a task whose kind triage has not chosen yet', () => {
  it('names no kind and says Shinsa is still choosing it', () => {
    const task = createTask({ id: 't', stage: 'triage', auto: { shape: true, start: true, priority: true } });
    expect(isShapeChosen(task)).toBe(false);
    expect(resolveShapeLabel(task)).toBe('Kind not chosen yet');
    expect(resolveShapeIcon(task)).toBe('IconCircleDotted');
    expect(describeTaskSteps(task)).toBe('Shinsa is reading the request to choose what kind of task it is.');
    expect(
      isShapeChosen(createTask({ id: 'u', stage: 'triage', pipeline: ['answer'], auto: task.auto }))
    ).toBe(true);
  });
});
