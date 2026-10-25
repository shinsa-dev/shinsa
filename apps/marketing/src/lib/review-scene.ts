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
    message:
      'The draft is deleted after the store is inserted, outside a transaction. If the delete fails, finishing again creates a second store.',
  },
  {
    severity: 'suggestion',
    file: 'src/onboarding/progress-dots.tsx',
    line: lineOf(PROGRESS_DOTS_AFTER, 'aria-label'),
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
          why: 'Writes the draft. A step is saved only after it validates.',
        },
        {
          file: 'src/onboarding/draft-store.ts',
          ...span(DRAFT_STORE_AFTER, 'export async function createStore', 'return store.id'),
          attention: 'critical',
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
      call: 'Kept the draft per owner, not per browser',
      file: 'src/onboarding/draft-store.ts',
      line: lineOf(DRAFT_STORE_AFTER, 'where: { ownerId } });'),
      reason: 'An owner who switches devices halfway still resumes.',
    },
  ],
};

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
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
    plan: { version: 1, body: '', document: ONBOARDING_PLAN, proposedAt: now - 40 * MINUTE },
    report: REVIEW_REPORT,
    findings: REVIEW_FINDINGS,
    checkResults: REVIEW_CHECKS,
    pullRequest: null,
  });
}
