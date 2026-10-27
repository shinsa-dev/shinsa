import type {
  Activity,
  CiRun,
  Evidence,
  PhaseReport,
  PlanDocument,
  Repo,
  ReportCheck,
  ShinsaState,
  Task,
  TaskCheck,
} from '@shinsa/core';
import { type EvidenceLayout, resolveEvidenceListLayout } from '@/lib/evidence/layout.ts';
import { type ChecksView, resolveChecksView } from '@/lib/tasks/checks.ts';
import { createSampleState, createSampleTask, MINUTE } from './samples.ts';

const SAMPLES = '/samples/evidence';

export const SAMPLE_REPO: Repo = {
  id: 'shop',
  name: 'shop',
  path: '/Users/ada/Developer/shop',
  defaultBranch: 'main',
  remote: 'git@github.com:ada/shop.git',
  projectId: null,
  checkCommands: ['bun run lint'],
};

export const SAMPLE_PLAN_CHECKS: PlanDocument['verification'] = [
  { label: 'Currency tests', command: 'bun test apps/api/test/currency.test.ts', phases: [1, 2, 3] },
  { label: 'API types', command: 'bun run --cwd apps/api check-types', phases: [2, 3] },
  { label: 'Backfill dry run', command: 'bun scripts/backfill-currency.ts --dry-run', phases: [3] },
];

const PLAN: PlanDocument = {
  goal: 'Products without a currency use the store’s default.',
  phases: [
    { title: 'Read the store’s default currency', detail: 'In the editor and in the API.' },
    { title: 'Type the API’s currency', detail: 'A product’s currency is never null.' },
    { title: 'Add the backfill script', detail: 'A dry run prints what it would change.' },
  ],
  behaviour: [],
  approach: '',
  files: [],
  outOfScope: [],
  verification: SAMPLE_PLAN_CHECKS,
  questions: [],
};

const TASK_CHECKS: TaskCheck[] = SAMPLE_PLAN_CHECKS.map((check, index) => ({
  ...check,
  id: `c${index + 1}`,
  source: 'plan',
}));

const AGENT_CHECK: TaskCheck = {
  id: 'c4',
  label: 'Webhook retry test',
  command: 'bun test apps/api/test/webhooks/retry.test.ts',
  phases: [3],
  source: 'agent',
};

function pass(check: TaskCheck, detail: string | null = null): ReportCheck {
  return { id: check.id, label: check.label, command: check.command, outcome: 'pass', detail };
}

function fail(check: TaskCheck, detail: string): ReportCheck {
  return { id: check.id, label: check.label, command: check.command, outcome: 'fail', detail };
}

const [CURRENCY, TYPES, BACKFILL] = TASK_CHECKS as [TaskCheck, TaskCheck, TaskCheck];

const LINT: TaskCheck = {
  id: 'r1',
  label: 'bun run lint',
  command: 'bun run lint',
  phases: [],
  source: 'repo',
};

const CI_RUNS: CiRun[] = [
  { name: 'build', status: 'success', required: true, url: 'https://github.com/ada/shop/actions/runs/1' },
  { name: 'test (ubuntu-latest)', status: 'pending', required: true, url: null },
  { name: 'e2e', status: 'failure', required: false, url: 'https://github.com/ada/shop/actions/runs/3' },
];

function listPhaseReports(now: number, count: number): PhaseReport[] {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    summary: `Phase ${index + 1} done.`,
    spots: [],
    judgementCalls: [],
    at: now - (count - index) * 10 * MINUTE,
  }));
}

function createChecksTask(now: number, id: string, overrides: Partial<Task>) {
  return createSampleTask(now, {
    id,
    title: 'Default a product’s currency to the store’s',
    repoId: SAMPLE_REPO.id,
    stage: 'awaiting_review',
    stageReason: 'waiting for your review',
    plan: {
      version: 1,
      body: '',
      document: PLAN,
      proposedAt: now - 60 * MINUTE,
      approvedAt: now - 50 * MINUTE,
    },
    phaseReports: listPhaseReports(now, 3),
    checks: TASK_CHECKS,
    ...overrides,
  });
}

const ACTIVITY: Activity[] = [
  {
    at: 0,
    actor: 'agent',
    kind: 'check',
    text: 'Added the check “Webhook retry test”',
    detail: '`bun test apps/api/test/webhooks/retry.test.ts`: the retry path in phase 3 had no test.',
    evidenceId: null,
  },
  {
    at: 0,
    actor: 'shinsa',
    kind: 'check',
    text: '1 of 4 checks failed',
    detail: [
      'API types: `bun run --cwd apps/api check-types` failed',
      'Backfill dry run: already failing on the base branch, so it does not block',
    ].join('\n'),
    evidenceId: null,
  },
];

function createEvidence(now: number): Evidence[] {
  return [
    {
      id: 'currency-link',
      taskId: 'linked',
      runId: 'linked-run',
      kind: 'test',
      title: CURRENCY.label,
      uri: `shinsa://check/${CURRENCY.id}`,
      checkId: CURRENCY.id,
      detail: 'Covers a product with no currency in the editor and in the API.',
      attachedAt: now - 8 * MINUTE,
    },
    {
      id: 'currency-output',
      taskId: 'linked',
      runId: null,
      kind: 'check',
      title: CURRENCY.label,
      uri: `${SAMPLES}/tab-group-tests.txt`,
      checkId: CURRENCY.id,
      attachedAt: now - 6 * MINUTE,
    },
    {
      id: 'lint-output',
      taskId: 'linked',
      runId: null,
      kind: 'check',
      title: LINT.label,
      uri: `${SAMPLES}/checks.txt`,
      checkId: LINT.id,
      attachedAt: now - 6 * MINUTE,
    },
  ];
}

export interface ChecksScene {
  state: ShinsaState;
  views: Record<ChecksSpecimen, ChecksView>;
  evidence: EvidenceLayout;
  evidenceChecks: ChecksView | null;
  activity: Activity[];
}

export type ChecksSpecimen = 'running' | 'passed' | 'failing' | 'alone' | 'base' | 'ci';

export function createChecksScene(now: number): ChecksScene {
  const passed = [...TASK_CHECKS, AGENT_CHECK, LINT].map((check) => pass(check));
  const tasks: Record<ChecksSpecimen | 'linked', Task> = {
    running: createChecksTask(now, 'running', {
      stage: 'checking',
      stageReason: 'running the checks for phase 2 of 3',
      runningChecks: TASK_CHECKS.filter((check) => check.phases.includes(2)).map((check) => check.id),
      phaseReports: listPhaseReports(now, 2),
      checkResults: [pass(CURRENCY, '12 pass')],
    }),
    passed: createChecksTask(now, 'passed', {
      checks: [...TASK_CHECKS, AGENT_CHECK],
      checkResults: passed,
    }),
    failing: createChecksTask(now, 'failing', {
      stage: 'fixing',
      stageReason: 'fixing what the checks found',
      checkResults: [
        pass(CURRENCY),
        fail(TYPES, "apps/api/src/currency.ts(14,3): error TS2322: Type 'string | null' is not assignable."),
        pass(BACKFILL),
        pass(LINT),
      ],
    }),
    alone: createChecksTask(now, 'alone', {
      checkResults: [{ ...pass(CURRENCY), note: 'passed_alone' }, pass(TYPES), pass(BACKFILL), pass(LINT)],
    }),
    base: createChecksTask(now, 'base', {
      checkResults: [
        pass(CURRENCY),
        pass(TYPES),
        { ...fail(BACKFILL, 'connect ECONNREFUSED 127.0.0.1:5432'), note: 'fails_on_base' },
        pass(LINT),
      ],
    }),
    ci: createChecksTask(now, 'ci', {
      stage: 'awaiting_merge',
      stageReason: 'waiting for CI',
      checkResults: [pass(CURRENCY), pass(TYPES), pass(BACKFILL), pass(LINT)],
      pullRequest: {
        number: 42,
        url: 'https://github.com/ada/shop/pull/42',
        base: 'main',
        state: 'open',
        checks: 'pending',
        unresolvedComments: 0,
        mergeable: true,
        updatedAt: now - 2 * MINUTE,
        checkRuns: CI_RUNS,
      },
    }),
    linked: createChecksTask(now, 'linked', {
      checkResults: [pass(CURRENCY, '2 pass'), pass(TYPES), pass(BACKFILL), pass(LINT)],
    }),
  };
  const evidence = createEvidence(now);
  const state: ShinsaState = {
    ...createSampleState({ tasks: Object.values(tasks) }),
    repos: { [SAMPLE_REPO.id]: SAMPLE_REPO },
    evidence: Object.fromEntries(evidence.map((piece) => [piece.id, piece])),
  };
  const view = (task: Task) => resolveChecksView(state, task) as ChecksView;
  return {
    state,
    views: {
      running: view(tasks.running),
      passed: view(tasks.passed),
      failing: view(tasks.failing),
      alone: view(tasks.alone),
      base: view(tasks.base),
      ci: view(tasks.ci),
    },
    evidence: resolveEvidenceListLayout(evidence, {}),
    evidenceChecks: resolveChecksView(state, tasks.linked),
    activity: ACTIVITY.map((entry, index) => ({ ...entry, at: now - (index + 1) * 4 * MINUTE })),
  };
}
