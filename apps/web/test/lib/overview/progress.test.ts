import { describe, expect, it } from 'bun:test';
import { type PhaseProgress, resolveTaskProgress, type Task, type TaskProgress } from '@shinsa/core';
import {
  describeStep,
  describeStepCount,
  describeTrackPosition,
  isStepReached,
  resolveLabelFold,
  resolveStageNote,
  resolveStepStatusLabel,
  resolveSteps,
  STEP_STATUS_LABEL,
  type Step,
  selectCurrentStep,
} from '@/lib/overview/progress.ts';
import { createTask } from '../../support/state.ts';

function withPlan(task: Partial<Task> & { id: string }, titles: string[], phases: PhaseProgress['status'][]) {
  return createTask({
    ...task,
    plan: {
      version: 1,
      body: '',
      proposedAt: 0,
      document: {
        goal: '',
        phases: titles.map((title) => ({ title, detail: `${title} in detail` })),
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
  it('shows no repository step for a question that has no repository, and one for work that needs it', () => {
    const question = createTask({ id: 'hey', stage: 'answering', size: 'small', pipeline: ['answer'] });
    expect(describeSteps(resolveSteps(resolveTaskProgress(question)))).toEqual(['Answer: current']);
    const investigation = createTask({
      id: 'why',
      stage: 'triage',
      size: 'small',
      pipeline: ['investigate'],
    });
    expect(resolveSteps(resolveTaskProgress(investigation)).map((step) => step.label)).toEqual([
      'Repository',
      'Investigate',
    ]);
  });

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
    const steps = resolveSteps(resolveTaskProgress(createTask({ id: 'task-1', stage: 'waiting_on_tasks' })));
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

describe('resolveStageNote', () => {
  it('names the conflict being resolved while the agent fixes one, and nothing otherwise', () => {
    const fixing = { stage: 'fixing', stageReason: 'resolving conflicts with main' } as const;
    expect(resolveStageNote({ ...fixing, fixFor: 'conflict' })).toBe('Resolving conflicts with main');
    expect(
      resolveStageNote({
        ...fixing,
        fixFor: 'update',
        stageReason: 'resolving conflicts with the base branch',
      })
    ).toBe('Resolving conflicts with the base branch');
    expect(resolveStageNote({ ...fixing, fixFor: 'checks' })).toBeNull();
    expect(resolveStageNote({ ...fixing, fixFor: 'conflict', stageReason: '' })).toBeNull();
    expect(resolveStageNote({ ...fixing, stage: 'shipping', fixFor: 'conflict' })).toBeNull();
  });
});

describe('resolveStepStatusLabel', () => {
  const step: Step = {
    key: 'pull-request',
    label: 'Pull request',
    count: null,
    status: 'current',
    detail: [],
  };

  it('puts the stage note in place of In progress on the current step only', () => {
    expect(resolveStepStatusLabel(step, 'Resolving conflicts with main')).toBe(
      'Resolving conflicts with main'
    );
    expect(resolveStepStatusLabel(step, null)).toBe('In progress');
    expect(resolveStepStatusLabel({ ...step, status: 'done' }, 'Resolving conflicts with main')).toBe('Done');
  });
});

describe('the stage strip for each kind of task', () => {
  function stripOf(task: Partial<Task>) {
    return describeSteps(
      resolveSteps(resolveTaskProgress(createTask({ id: 't', repoId: 'repo-1', ...task })))
    );
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

  it('counts the steps around the merge as long labels, and shows how many are done as the count', () => {
    const step = {
      when: 'pre_merge' as const,
      kind: 'env' as const,
      title: 'Set A',
      detail: 'd',
      command: null,
    };
    const walkthrough = {
      approach: 'a',
      flow: 'f',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [step, { ...step, when: 'post_merge' as const, title: 'Deploy' }],
    };
    const steps = resolveSteps(
      resolveTaskProgress(
        createTask({
          id: 't',
          stage: 'awaiting_merge',
          pipeline: [
            'plan',
            'build',
            'checks',
            'agent_review',
            'your_review',
            'pull_request',
            'pre_merge',
            'merge',
            'post_merge',
          ],
          phaseReports: [{ index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 }],
        })
      )
    );
    const before = steps.find((candidate) => candidate.key === 'pre-merge');
    expect(before).toMatchObject({ label: 'Pre-merge', count: '0/1', status: 'waiting', detail: [] });
    expect(steps.find((candidate) => candidate.key === 'post-merge')?.label).toBe('Post-merge');
    expect(steps.map((candidate) => resolveLabelFold(candidate, steps))[0]).toBe('always');
  });
});

function sampleStep(key: string, status: Step['status'], count: string | null = null): Step {
  return { key, label: key, count, status, detail: [] };
}

describe('the current step', () => {
  it('picks the step in progress or the one waiting on you, and names it with its count', () => {
    const building = [
      sampleStep('Plan', 'done'),
      sampleStep('Build', 'current', '1/2'),
      sampleStep('Checks', 'pending'),
    ];
    expect(selectCurrentStep(building)?.key).toBe('Build');
    expect(describeStep(building[1] as Step)).toBe('Build 1/2');
    expect(describeTrackPosition(building)).toBe('Step 2 of 3: Build 1/2');

    const review = [sampleStep('Build', 'done'), sampleStep('Your review', 'waiting')];
    expect(describeStep(selectCurrentStep(review) as Step)).toBe('Your review');
    expect(describeTrackPosition(review)).toBe('Step 2 of 2: Your review');
  });

  it('names a step only when it has a count', () => {
    expect(describeStepCount(sampleStep('Build', 'current', '1/2'), 'Building')).toBe('Build 1/2');
    expect(describeStepCount(sampleStep('Your review', 'waiting'), 'Changes to review')).toBeNull();
    expect(describeStepCount(null, 'Building')).toBeNull();
  });

  it('leaves the count out when the status already names the step', () => {
    expect(
      describeStepCount(sampleStep('Pre-merge', 'waiting', '1/2'), 'Pre-merge · 1 step left')
    ).toBeNull();
  });

  it('counts the steps done when none is current', () => {
    const between = [
      sampleStep('Plan', 'done'),
      sampleStep('Run', 'skipped'),
      sampleStep('Build', 'pending'),
    ];
    expect(selectCurrentStep(between)).toBeNull();
    expect(describeTrackPosition(between)).toBe('2 of 3 steps done');
  });

  it('follows a real task through the track', () => {
    const task = withPlan({ id: 'task-1', stage: 'building' }, ['Set up', 'Wire'], ['done', 'active']);
    const current = selectCurrentStep(resolveSteps(resolveTaskProgress(task)));
    expect(current && describeStep(current)).toBe('Build 1/2');
  });
});
