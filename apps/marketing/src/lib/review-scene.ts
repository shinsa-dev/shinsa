import type { ReportCheck, ReviewFinding, Task, WorkReport } from '@shinsa/core';
import { createSampleTask, MINUTE } from '@/routes/ui/samples.ts';
import { lineOf } from './demo-repo.ts';
import {
  DRAFT_STORE_AFTER,
  DRAFT_TEST_AFTER,
  PROGRESS_DOTS_AFTER,
  RESUME_AFTER,
  ROUTE_AFTER,
  STEPS_AFTER,
} from './onboarding-code.ts';
import { ONBOARDING_PLAN, PROJECT } from './scene.ts';

function span(content: string, from: string, to: string) {
  return { start: lineOf(content, from), end: lineOf(content, to) };
}

export const REVIEW_FINDINGS: ReviewFinding[] = [
  {
    severity: 'blocking',
    file: 'src/onboarding/draft-store.ts',
    line: lineOf(DRAFT_STORE_AFTER, 'db.storeDrafts.delete'),
    title: 'The draft outlives a failed delete',
    message:
      'The draft is deleted after the store is inserted, outside a transaction. If the delete fails, finishing again creates a second store.',
    fix: 'Insert the store and delete the draft in one `db.transaction`.',
  },
  {
    severity: 'suggestion',
    file: 'src/onboarding/progress-dots.tsx',
    line: lineOf(PROGRESS_DOTS_AFTER, 'aria-label'),
    title: 'Label the whole progress row',
    message: 'The step label is on the list; on the wrapper it would also cover the Back button.',
  },
];

export const REVIEW_CHECKS: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
  { name: 'bun run test', outcome: 'pass', detail: '214 tests, 3 new' },
];

export const REVIEW_REPORT: WorkReport = {
  headline: 'Onboarding is three steps; each one is saved as a draft, and a reload resumes on the next.',
  sections: [
    {
      title: 'Split the form into steps',
      summary:
        'The 14 fields are three steps with their own validation. The route renders one step at a time.',
      spots: [
        {
          file: 'src/onboarding/steps.ts',
          ...span(STEPS_AFTER, 'export function validateStep', 'return problems;'),
          attention: 'high',
          title: 'Each step validates on its own',
          explain:
            'The old form checked all 14 fields on submit. Now each step checks only its own answers, so step one can be saved with payments still empty.',
          why: 'Validation moved here from the form; an empty name or no payment provider is refused.',
        },
        {
          file: 'src/routes/onboarding.tsx',
          ...span(ROUTE_AFTER, 'const owner = useOwner', '</main>'),
          attention: 'normal',
          why: 'The route asks where to resume, then renders that step.',
        },
      ],
    },
    {
      title: 'Save each step as it is finished',
      summary:
        'A store draft keeps the answers per owner. The store is only created once all three steps are saved.',
      spots: [
        {
          file: 'src/onboarding/draft-store.ts',
          ...span(DRAFT_STORE_AFTER, 'export async function saveStep', 'return { saved: true'),
          attention: 'critical',
          title: 'Saving a step',
          explain:
            'A step is validated, then merged into the owner’s draft with the list of finished steps. Nothing is written when validation fails.',
          why: 'Writes the draft. A step is saved only after it validates.',
        },
        {
          file: 'src/onboarding/draft-store.ts',
          ...span(DRAFT_STORE_AFTER, 'export async function createStore', 'return store.id'),
          attention: 'critical',
          title: 'Turning the draft into a store',
          explain:
            'Once all three steps are finished, the answers become a store and the draft is removed. Before that it refuses.',
          why: 'Creates the store from the draft and deletes the draft.',
        },
        {
          file: 'test/onboarding/draft-store.test.ts',
          ...span(DRAFT_TEST_AFTER, 'a reload resumes', "toBe('payments')"),
          attention: 'normal',
          why: 'Failed before the change, passes now.',
        },
      ],
    },
    {
      title: 'Show progress at the top',
      summary: 'Three dots and a Back link from step two on. Resuming lands on the first unfinished step.',
      spots: [
        {
          file: 'src/onboarding/resume.ts',
          ...span(RESUME_AFTER, 'export async function resolveResumeStep', "return next?.id ?? 'shipping'"),
          attention: 'high',
          title: 'Where a returning owner lands',
          explain: 'The first step not in the draft’s finished list. You chose this during the build.',
          why: 'Decides where a returning owner lands, which you answered during the build.',
        },
        {
          file: 'src/onboarding/progress-dots.tsx',
          ...span(PROGRESS_DOTS_AFTER, 'export function ProgressDots', '</ol>'),
          attention: 'normal',
          why: 'Presentational only.',
        },
      ],
    },
  ],
  checks: REVIEW_CHECKS,
  judgementCalls: [
    {
      title: 'One draft per owner',
      call: 'Kept the draft per owner, not per browser',
      file: 'src/onboarding/draft-store.ts',
      line: lineOf(DRAFT_STORE_AFTER, 'where: { ownerId } });'),
      reason: 'An owner who switches devices halfway still resumes.',
      alternatives: [
        { option: 'A draft in localStorage', rejected: 'Lost on another device or a cleared browser.' },
      ],
    },
    {
      title: 'Validate each step once',
      call: 'Validated per step, not again at the end',
      file: 'src/onboarding/steps.ts',
      line: lineOf(STEPS_AFTER, 'export function validateStep'),
      reason: 'Every step is checked when it is saved, so the last step only checks that all three exist.',
      alternatives: [
        {
          option: 'Validate the whole draft before creating the store',
          rejected: 'The same rules twice, in two places that can drift.',
        },
      ],
    },
  ],
  walkthrough: {
    approach:
      'Split the one long form into three routes that share a draft per owner. Each step validates and saves on its own; the store is created from the draft once every step is done.',
    flow: 'Opening onboarding asks `resolveResumeStep` where to land, renders that step, and `saveStep` writes the answers to `storeDrafts` on Continue. Finishing the third step calls `createStore`, which turns the draft into a store and removes the draft.',
    risks: [
      {
        title: 'Leftover draft on a failed delete',
        risk: 'A failed delete leaves a draft behind, and finishing again would create a second store.',
        file: 'src/onboarding/draft-store.ts',
        line: lineOf(DRAFT_STORE_AFTER, 'export async function createStore'),
        end: lineOf(DRAFT_STORE_AFTER, 'return store.id'),
      },
    ],
    testing: {
      automated: [
        '`draft-store.test.ts` covers resuming after a reload, refusing an empty store name and creating the store only at the end.',
      ],
      manual: [
        {
          action: 'Open onboarding, fill in step one and reload.',
          target: { kind: 'url', value: 'http://localhost:5173/onboarding' },
          expect: 'You land on Payments with step one kept.',
        },
        {
          action: 'Leave the store name empty and press Continue.',
          target: null,
          expect: 'Continue refuses and nothing is saved.',
        },
        {
          action: 'Finish all three steps.',
          target: null,
          expect: 'One store, and the draft is gone.',
        },
      ],
    },
  },
};

const REVIEW_DISAGREEMENTS = [
  {
    call: 'Validated per step, not again at the end',
    reason:
      'A draft written before a rule changed would skip the new rule. One check in `createStore` would catch it.',
  },
];

export function createReviewTask(now: number): Task {
  return createSampleTask(now, {
    id: 'review-onboarding',
    handle: 'NW-155',
    projectId: PROJECT.id,
    repoId: 'web',
    title: 'Split store onboarding into steps',
    stage: 'awaiting_review',
    stageReason: 'changes to review',
    branch: 'feat/onboarding-steps',
    worktreePath: '~/.config/shinsa/data/worktrees/northwind-web/NW-155',
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
    plan: { version: 1, body: '', document: ONBOARDING_PLAN, proposedAt: now - 40 * MINUTE },
    report: REVIEW_REPORT,
    findings: REVIEW_FINDINGS,
    reviewDisagreements: REVIEW_DISAGREEMENTS,
    checkResults: REVIEW_CHECKS,
    pullRequest: null,
  });
}
