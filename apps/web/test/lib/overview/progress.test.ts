import { describe, expect, it } from 'bun:test';
import { type PhaseProgress, resolveTaskProgress, type Task, type TaskProgress } from '@shinsa/core';
import {
  isStepReached,
  resolveLabelFold,
  resolveSteps,
  STEP_STATUS_LABEL,
  type Step,
} from '@/lib/overview/progress.ts';
import { createTask } from '../../support/state.ts';

function withPlan(task: Partial<Task> & { id: string }, titles: string[], phases: PhaseProgress['status'][]) {
  return createTask({
    ...task,
    spec: {
      version: 1,
      body: '',
      proposedAt: 0,
      document: {
        goal: '',
        plan: titles.map((title) => ({ title, detail: `${title} in detail` })),
        behaviour: [],
        approach: '',
        files: [],
        outOfScope: [],
        verification: [],
        questions: [],
      },
    },
    phases: phases.map((status) => ({ status }) as PhaseProgress),
  });
}

function describeSteps(steps: Step[]) {
  return steps.map((step) => `${step.label}${step.count ? ` ${step.count}` : ''}: ${step.status}`);
}

describe('resolveSteps', () => {
  it('checks a skipped phase in the Build tooltip, as the count already counts it', () => {
    const task = withPlan({ id: 'task-1', stage: 'building' }, ['Model', 'Endpoint'], ['skipped', 'active']);
    const build = resolveSteps(resolveTaskProgress(task)).find((step) => step.key === 'build');
    expect(build?.count).toBe('1/2');
    expect(build?.detail.map((line) => line.done)).toEqual([true, false]);
  });

  it('shows the whole track for a task being built without a plan', () => {
    const steps = resolveSteps(resolveTaskProgress(createTask({ id: 'task-1', stage: 'building' })));
    expect(describeSteps(steps)).toEqual([
      'Plan: done',
      'Build: current',
      'Checks: pending',
      'Your review: pending',
      'Pull request: pending',
      'Merge: pending',
    ]);
    expect(steps.find((step) => step.key === 'build')?.detail).toEqual([]);
  });

  it('reads composed steps in order: build without checks, and an operation after the merge or before building', () => {
    const steps = (pipeline: Task['pipeline'], stage: Task['stage'] = 'planning') =>
      resolveSteps(resolveTaskProgress(createTask({ id: 'task-1', stage, pipeline }))).map(
        (step) => step.label
      );
    expect(steps(['plan', 'build', 'your_review', 'pull_request', 'merge'])).toEqual([
      'Plan',
      'Build',
      'Your review',
      'Pull request',
      'Merge',
    ]);
    expect(
      steps(['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge', 'operate'])
    ).toEqual(['Plan', 'Build', 'Checks', 'Your review', 'Pull request', 'Merge', 'Run']);
    expect(steps(['plan', 'operate', 'build', 'your_review', 'pull_request', 'merge'])).toEqual([
      'Plan',
      'Run',
      'Build',
      'Your review',
      'Pull request',
      'Merge',
    ]);
  });

  it('folds the plan’s phases into Build with a count of finished phases', () => {
    const task = withPlan(
      { id: 'task-1', stage: 'building' },
      ['Model', 'Endpoint', 'Button'],
      ['done', 'active', 'pending']
    );
    const steps = resolveSteps(resolveTaskProgress(task));
    expect(describeSteps(steps)).toContain('Build 1/3: current');
    expect(steps.map((step) => step.key)).toEqual([
      'plan',
      'build',
      'check',
      'review',
      'pull-request',
      'merge',
    ]);
    expect(steps[1]?.detail).toEqual([
      { text: '1. Model', done: true },
      { text: '2. Endpoint', done: false },
      { text: '3. Button', done: false },
    ]);
  });

  it('counts a skipped phase as finished', () => {
    const task = withPlan(
      { id: 'task-1', stage: 'building' },
      ['Model', 'Endpoint', 'Button'],
      ['done', 'skipped', 'active']
    );
    expect(describeSteps(resolveSteps(resolveTaskProgress(task)))).toContain('Build 2/3: current');
  });

  it('shows no count for a plan with a single phase', () => {
    const task = withPlan({ id: 'task-1', stage: 'building' }, ['Everything'], ['active']);
    const build = resolveSteps(resolveTaskProgress(task))[1];
    expect(build?.count).toBeNull();
    expect(build?.detail).toEqual([{ text: '1. Everything', done: false }]);
  });

  it('marks Build done once every phase is finished', () => {
    const task = withPlan({ id: 'task-1', stage: 'awaiting_review' }, ['Model', 'Button'], ['done', 'done']);
    expect(describeSteps(resolveSteps(resolveTaskProgress(task)))).toEqual([
      'Plan: done',
      'Build 2/2: done',
      'Checks: done',
      'Your review: waiting',
      'Pull request: pending',
      'Merge: pending',
    ]);
  });

  it('leaves Build not started before any phase begins', () => {
    const task = withPlan({ id: 'task-1', stage: 'awaiting_plan' }, ['Model', 'Button'], []);
    expect(describeSteps(resolveSteps(resolveTaskProgress(task))).slice(0, 2)).toEqual([
      'Plan: waiting',
      'Build 0/2: pending',
    ]);
  });

  it('carries a step’s detail, such as why it has not started', () => {
    const steps = resolveSteps(resolveTaskProgress(createTask({ id: 'task-1', stage: 'queued' })));
    expect(steps[0]?.detail).toEqual([{ text: 'Starts when the task it waits on finishes', done: false }]);
  });

  it('marks every step done once merged', () => {
    const steps = resolveSteps(resolveTaskProgress(createTask({ id: 'task-1', stage: 'merged' })));
    expect(steps.every((step) => step.status === 'done')).toBe(true);
  });

  it('labels an unknown step by its own title', () => {
    const progress: TaskProgress = {
      phases: [{ key: 'deploy', title: 'Deploy', detail: null, status: 'skipped', planned: false }],
      current: null,
      position: 0,
      total: 1,
      done: 1,
    };
    expect(describeSteps(resolveSteps(progress))).toEqual(['Deploy: skipped']);
  });
});

describe('isStepReached', () => {
  it('is true for done and skipped steps', () => {
    const step = (status: Step['status']): Step => ({
      key: 'x',
      label: 'X',
      count: null,
      status,
      detail: [],
    });
    expect(isStepReached(step('done'))).toBe(true);
    expect(isStepReached(step('skipped'))).toBe(true);
    expect(isStepReached(step('current'))).toBe(false);
    expect(isStepReached(step('waiting'))).toBe(false);
    expect(isStepReached(step('pending'))).toBe(false);
  });
});

describe('STEP_STATUS_LABEL', () => {
  it('says every status in words', () => {
    expect(STEP_STATUS_LABEL).toEqual({
      done: 'Done',
      skipped: 'Skipped',
      current: 'In progress',
      waiting: 'Waiting on you',
      pending: 'Not started',
    });
  });
});

describe('the stage strip for each kind of task', () => {
  function stripOf(task: Partial<Task>) {
    return describeSteps(resolveSteps(resolveTaskProgress(createTask({ id: 't', ...task }))));
  }

  it('shows an answer as finding the repository, then answering', () => {
    expect(stripOf({ pipeline: ['answer'], stage: 'answering' })).toEqual([
      'Repository: done',
      'Answer: current',
    ]);
  });

  it('shows an investigation and research as one step after the repository', () => {
    expect(stripOf({ pipeline: ['investigate'], stage: 'investigating' })).toEqual([
      'Repository: done',
      'Investigate: current',
    ]);
    expect(
      stripOf({
        pipeline: ['research'],
        stage: 'done',
        result: { step: 'research', body: 'Report.', runId: null, at: 0 },
      })
    ).toEqual(['Repository: done', 'Research: done']);
  });

  it('adds Your OK while a change waits on you after an investigation', () => {
    expect(
      stripOf({
        pipeline: ['investigate'],
        stage: 'awaiting_proposal',
        result: { step: 'investigate', body: 'Findings.', runId: null, at: 0 },
      })
    ).toEqual(['Repository: done', 'Investigate: done', 'Your OK: waiting']);
  });

  it('shows find and fix as the investigation, then the whole change', () => {
    expect(
      stripOf({
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
        stage: 'planning',
        result: { step: 'investigate', body: 'Findings.', runId: null, at: 0 },
      })
    ).toEqual([
      'Repository: done',
      'Investigate: done',
      'Plan: current',
      'Build: pending',
      'Checks: pending',
      'Your review: pending',
      'Pull request: pending',
      'Merge: pending',
    ]);
  });

  it('shows an operation as its plan, then running it', () => {
    expect(stripOf({ pipeline: ['plan', 'operate'], stage: 'operating' })).toEqual([
      'Plan: done',
      'Run: current',
    ]);
  });
});

describe('resolveLabelFold', () => {
  it('folds the labels of finished steps only on a strip longer than a change’s', () => {
    const fix = resolveSteps(
      resolveTaskProgress(
        createTask({
          id: 't',
          stage: 'building',
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
          result: { step: 'investigate', body: 'Found it.', runId: null, at: 0 },
        })
      )
    );
    expect(fix.map((step) => resolveLabelFold(step, fix))).toEqual([
      'narrow',
      'narrow',
      'narrow',
      null,
      null,
      null,
      null,
      null,
    ]);
    const change = resolveSteps(resolveTaskProgress(createTask({ id: 't', stage: 'building' })));
    expect(change.some((step) => resolveLabelFold(step, change) !== null)).toBe(false);
  });

  it('folds them at every width on a strip longer than find and fix, such as research before a change', () => {
    const composed = resolveSteps(
      resolveTaskProgress(
        createTask({
          id: 't',
          stage: 'researching',
          pipeline: [
            'research',
            'your_ok',
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
    );
    expect(composed.map((step) => resolveLabelFold(step, composed))).toEqual([
      'always',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});
