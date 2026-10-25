import type { Activity, ChatEvent, Gate, PhaseProgress, ShinsaState, Task } from '@shinsa/core';
import {
  createSampleGate,
  createSampleRun,
  createSampleState,
  createSampleTask,
  MINUTE,
} from '@/routes/ui/samples.ts';
import { REVIEW_CHECKS, REVIEW_FINDINGS, REVIEW_REPORT } from './review-scene.ts';
import { createPullRequest, ONBOARDING_PLAN, PROJECT } from './scene.ts';

export type GateStep =
  | 'plan'
  | 'build'
  | 'question'
  | 'finish'
  | 'review'
  | 'fix'
  | 'ship'
  | 'merge'
  | 'merged';

export const GATE_RUN_ID = 'gates-run';

const TASK_ID = 'gates-onboarding';

const PIPELINE: Task['pipeline'] = [
  'plan',
  'build',
  'checks',
  'agent_review',
  'your_review',
  'pull_request',
  'merge',
];

function phases(now: number, done: number): PhaseProgress[] {
  return [0, 1, 2].map((index) => ({
    status: index < done ? 'done' : index === done ? 'active' : 'pending',
    at: now - (3 - index) * MINUTE,
  }));
}

function resolveTaskPatch(now: number, step: GateStep, fixed: boolean): Partial<Task> {
  switch (step) {
    case 'plan':
      return { stage: 'awaiting_plan', stageReason: 'plan to approve' };
    case 'build':
      return { stage: 'building', stageReason: 'building phase 1 of 3', phases: phases(now, 0) };
    case 'question':
      return { stage: 'building', stageReason: 'needs your answer', phases: phases(now, 1) };
    case 'finish':
      return { stage: 'building', stageReason: 'building phase 3 of 3', phases: phases(now, 2) };
    case 'review':
      return {
        stage: 'awaiting_review',
        stageReason: 'changes to review',
        phases: phases(now, 3),
        findings: fixed ? [] : REVIEW_FINDINGS,
        report: REVIEW_REPORT,
        checkResults: REVIEW_CHECKS,
      };
    case 'fix':
      return {
        stage: 'fixing',
        stageReason: 'fixing what you kept',
        phases: phases(now, 3),
        checkResults: REVIEW_CHECKS,
      };
    case 'ship':
      return {
        stage: 'shipping',
        stageReason: 'opening the pull request',
        phases: phases(now, 3),
        checkResults: REVIEW_CHECKS,
      };
    case 'merge':
      return {
        stage: 'awaiting_merge',
        stageReason: 'ready to merge',
        phases: phases(now, 3),
        checkResults: REVIEW_CHECKS,
        pullRequest: createPullRequest(now, 821),
      };
    case 'merged':
      return {
        stage: 'merged',
        stageReason: 'merged',
        phases: phases(now, 3),
        checkResults: REVIEW_CHECKS,
        pullRequest: createPullRequest(now, 821, { state: 'merged' }),
      };
  }
}

function resolveGate(now: number, step: GateStep): Gate | null {
  const base = { taskId: TASK_ID, openedAt: now - 20_000 };
  switch (step) {
    case 'plan':
      return createSampleGate(now, {
        ...base,
        id: 'gates-plan',
        type: 'plan',
        title: 'Approve the plan',
        planVersion: 1,
      });
    case 'question':
      return createSampleGate(now, {
        ...base,
        id: 'gates-question',
        type: 'question',
        title: 'Where should a half-finished store land after signing in again?',
        body: 'Phase 2 saves each step as it is finished. A store that left halfway needs somewhere to resume.',
        choices: ['On the first step it has not finished', 'Back on the first step, answers kept'],
        recommendation: 'On the first step it has not finished',
        runId: GATE_RUN_ID,
      });
    case 'review':
      return createSampleGate(now, {
        ...base,
        id: 'gates-review',
        type: 'review',
        title: 'Review the changes',
      });
    case 'merge':
      return createSampleGate(now, {
        ...base,
        id: 'gates-merge',
        type: 'merge',
        title: 'Merge the pull request',
      });
    default:
      return null;
  }
}

const ORDER: GateStep[] = ['plan', 'build', 'question', 'finish', 'review', 'fix', 'ship', 'merge', 'merged'];

const WORKING: GateStep[] = ['build', 'question', 'finish', 'fix', 'ship'];

export const PLAN_RUN_ID = 'gates-plan-run';

const REVIEW_RUN_ID = 'gates-review-run';

interface ActivityStep {
  from: GateStep;
  fixOnly?: boolean;
  entry: Omit<Activity, 'at' | 'detail' | 'evidenceId'> & { detail?: string };
}

const ACTIVITY: ActivityStep[] = [
  { from: 'plan', entry: { actor: 'you', kind: 'asked', text: 'Asked: split store onboarding into steps' } },
  {
    from: 'plan',
    entry: { actor: 'agent', kind: 'plan', text: 'Proposed a plan with 3 phases', runId: PLAN_RUN_ID },
  },
  { from: 'build', entry: { actor: 'you', kind: 'decision', text: 'Approved the plan', gateType: 'plan' } },
  {
    from: 'question',
    entry: { actor: 'agent', kind: 'work', text: 'Finished: Split the form into steps', runId: GATE_RUN_ID },
  },
  {
    from: 'question',
    entry: {
      actor: 'agent',
      kind: 'question',
      text: 'Asked where a half-finished store lands',
      runId: GATE_RUN_ID,
    },
  },
  {
    from: 'finish',
    entry: {
      actor: 'you',
      kind: 'decision',
      text: 'Answered: on the first step it has not finished',
      gateType: 'question',
    },
  },
  {
    from: 'review',
    entry: {
      actor: 'agent',
      kind: 'work',
      text: 'Finished: Save each step as it is finished',
      runId: GATE_RUN_ID,
    },
  },
  {
    from: 'review',
    entry: { actor: 'agent', kind: 'work', text: 'Finished: Show progress at the top', runId: GATE_RUN_ID },
  },
  {
    from: 'review',
    entry: { actor: 'shinsa', kind: 'review', text: 'The checks passed: lint, types and 214 tests' },
  },
  {
    from: 'review',
    entry: {
      actor: 'agent',
      kind: 'review',
      text: 'Agent review found 2 issues, 1 blocking',
      runId: REVIEW_RUN_ID,
    },
  },
  {
    from: 'fix',
    fixOnly: true,
    entry: { actor: 'you', kind: 'decision', text: 'Sent 1 finding back to fix', gateType: 'review' },
  },
  {
    from: 'fix',
    fixOnly: true,
    entry: {
      actor: 'agent',
      kind: 'fix',
      text: 'Fixed: the draft is deleted with the store, in one transaction',
      runId: GATE_RUN_ID,
    },
  },
  {
    from: 'ship',
    entry: { actor: 'you', kind: 'decision', text: 'Approved the changes', gateType: 'review' },
  },
  { from: 'merge', entry: { actor: 'shinsa', kind: 'pull_request', text: 'Opened pull request #821' } },
  {
    from: 'merge',
    entry: { actor: 'shinsa', kind: 'pull_request', text: 'CI passed and no comments are open' },
  },
  {
    from: 'merged',
    entry: { actor: 'you', kind: 'decision', text: 'Merged pull request #821', gateType: 'merge' },
  },
];

function listActivity(now: number, step: GateStep, fixed: boolean): Activity[] {
  const reached = ORDER.indexOf(fixed && step === 'review' ? 'fix' : step);
  const entries = ACTIVITY.filter((item) => ORDER.indexOf(item.from) <= reached && (!item.fixOnly || fixed));
  return entries.map((item, index) => ({
    detail: null,
    evidenceId: null,
    ...item.entry,
    at: now - (entries.length - index) * 40_000,
  }));
}

function listRuns(now: number, step: GateStep) {
  const reached = ORDER.indexOf(step);
  const working = WORKING.includes(step);
  const runs = [
    createSampleRun(now, {
      id: PLAN_RUN_ID,
      taskId: TASK_ID,
      purpose: 'plan',
      status: undefined,
      startedAt: now - 6 * MINUTE,
      endedAt: now - 4 * MINUTE,
      outcome: 'completed',
    }),
  ];
  if (reached >= ORDER.indexOf('build')) {
    runs.push(
      createSampleRun(now, {
        id: GATE_RUN_ID,
        taskId: TASK_ID,
        purpose: step === 'fix' ? 'fix' : 'build',
        startedAt: now - 3 * MINUTE,
        ...(working ? {} : { status: undefined, endedAt: now - MINUTE, outcome: 'completed' as const }),
      })
    );
  }
  if (reached >= ORDER.indexOf('review')) {
    runs.push(
      createSampleRun(now, {
        id: REVIEW_RUN_ID,
        taskId: TASK_ID,
        role: 'reviewer',
        status: undefined,
        startedAt: now - 2 * MINUTE,
        endedAt: now - MINUTE,
        outcome: 'completed',
      })
    );
  }
  return runs;
}

export function createGateScene(now: number, step: GateStep, fixed: boolean) {
  const task = createSampleTask(now, {
    id: TASK_ID,
    handle: 'NW-155',
    projectId: PROJECT.id,
    repoId: 'web',
    title: 'Split store onboarding into steps',
    branch: 'feat/onboarding-steps',
    pipeline: PIPELINE,
    plan: { version: 1, body: '', document: ONBOARDING_PLAN, proposedAt: now - 4 * MINUTE },
    activity: listActivity(now, step, fixed),
    ...resolveTaskPatch(now, step, fixed),
  });
  const gate = resolveGate(now, step);
  const state: ShinsaState = {
    ...createSampleState({ tasks: [task], gates: gate ? [gate] : [], runs: listRuns(now, step) }),
    projects: { [PROJECT.id]: PROJECT },
    focus: { projectId: PROJECT.id, until: null },
  };
  return { state, task, gate };
}

function read(path: string): ChatEvent {
  return { type: 'tool_call', callId: path, tool: { kind: 'read', path, range: null } };
}

function edit(path: string): ChatEvent {
  return { type: 'tool_call', callId: `edit:${path}`, tool: { kind: 'edit', path, hunks: [] } };
}

function run(command: string): ChatEvent {
  return {
    type: 'tool_call',
    callId: `run:${command}`,
    tool: { kind: 'command', action: 'run', command, description: null },
  };
}

function say(text: string): ChatEvent {
  return { type: 'agent', phase: 'interim', text };
}

export const PLAN_FEED: ChatEvent[] = [
  {
    type: 'user',
    from: 'you',
    text: 'Split store onboarding into steps. Leaving halfway should keep what was entered.',
    attachments: [],
  },
  read('src/onboarding/onboarding-form.tsx'),
  read('src/routes/onboarding.tsx'),
  read('src/onboarding/draft-store.ts'),
  say(
    'The form is one component with 14 fields in three fieldsets, and nothing is saved until the end. I’ll split it at the fieldsets and keep a draft per owner.'
  ),
  {
    type: 'tool_call',
    callId: 'propose_plan',
    tool: {
      kind: 'shinsa',
      name: 'propose_plan',
      args: { goal: ONBOARDING_PLAN.goal, phases: ONBOARDING_PLAN.phases },
    },
  },
];

export const GATE_FEEDS: Partial<Record<GateStep, ChatEvent[]>> = {
  build: [
    read('src/onboarding/onboarding-form.tsx'),
    read('src/routes/onboarding.tsx'),
    say('The form is one component with 14 fields. I’ll split it at the three fieldsets.'),
    edit('src/onboarding/steps/store-details.tsx'),
    edit('src/onboarding/steps/payments.tsx'),
    edit('src/onboarding/steps/shipping.tsx'),
    run('bun run test src/onboarding'),
  ],
  finish: [
    read('src/onboarding/draft-store.ts'),
    edit('src/onboarding/resume.ts'),
    edit('src/onboarding/progress-dots.tsx'),
    run('bun run test src/onboarding'),
    say('Resuming lands on the first unfinished step. Capturing screenshots in both themes.'),
  ],
  fix: [
    read('src/onboarding/draft-store.ts'),
    edit('src/onboarding/draft-store.ts'),
    run('bun run test src/onboarding/draft-store.test.ts'),
    say('The draft now saves only after the store name passes validation.'),
  ],
  ship: [run('bun lint'), run('bun check-types'), run('bun run test')],
};
