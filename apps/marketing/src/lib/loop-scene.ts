import type { Activity, PullRequest, ShinsaState, Task } from '@shinsa/core';
import { createSampleState, createSampleTask } from '@/routes/ui/samples.ts';
import { createPullRequest, PROJECT } from './scene.ts';

type LoopEntry = Pick<Activity, 'actor' | 'kind' | 'text'> & {
  detail?: string;
  pullRequest: Partial<PullRequest>;
  stage: Task['stage'];
  stageReason: string;
};

export const LOOP_ENTRIES: LoopEntry[] = [
  {
    actor: 'shinsa',
    kind: 'review',
    text: 'The checks passed: lint, types and 214 tests',
    pullRequest: {},
    stage: 'reviewing',
    stageReason: 'an agent is reviewing the change',
  },
  {
    actor: 'agent',
    kind: 'review',
    text: 'Agent review found 1 blocking issue',
    detail: 'The draft is deleted outside the transaction that creates the store.',
    pullRequest: {},
    stage: 'fixing',
    stageReason: 'fixing what the review found',
  },
  {
    actor: 'agent',
    kind: 'fix',
    text: 'Fixed: the draft is deleted in the same transaction',
    pullRequest: {},
    stage: 'awaiting_review',
    stageReason: 'changes to review',
  },
  {
    actor: 'you',
    kind: 'decision',
    text: 'Approved the changes',
    pullRequest: {},
    stage: 'shipping',
    stageReason: 'opening the pull request',
  },
  {
    actor: 'shinsa',
    kind: 'pull_request',
    text: 'Opened pull request #821',
    pullRequest: { checks: 'pending' },
    stage: 'shipping',
    stageReason: 'waiting for CI',
  },
  {
    actor: 'shinsa',
    kind: 'failure',
    text: 'CI failed: `bun check-types`',
    detail: '`src/onboarding/resume.ts(6)`: `draft` is possibly `null`.',
    pullRequest: { checks: 'failing' },
    stage: 'fixing',
    stageReason: 'fixing a failing CI check',
  },
  {
    actor: 'agent',
    kind: 'fix',
    text: 'Fixed the type error in `resume.ts`',
    pullRequest: { checks: 'pending' },
    stage: 'shipping',
    stageReason: 'waiting for CI',
  },
  {
    actor: 'shinsa',
    kind: 'review',
    text: 'A review bot left 1 comment',
    detail: '“`STEPS.find` runs on every render; memoize it.”',
    pullRequest: { checks: 'passing', unresolvedComments: 1 },
    stage: 'fixing',
    stageReason: 'answering a review comment',
  },
  {
    actor: 'agent',
    kind: 'fix',
    text: 'Answered the comment: the list has 3 items, so it stays as it is',
    pullRequest: { checks: 'passing', unresolvedComments: 0 },
    stage: 'shipping',
    stageReason: 'waiting for CI',
  },
  {
    actor: 'shinsa',
    kind: 'stage',
    text: 'CI passed and no comments are open. Ready to merge',
    pullRequest: { checks: 'passing', mergeable: true },
    stage: 'awaiting_merge',
    stageReason: 'ready to merge',
  },
];

export function createLoopState(now: number, shown: number): { state: ShinsaState; task: Task } {
  const visible = LOOP_ENTRIES.slice(0, Math.max(1, shown));
  const latest = visible.at(-1)!;
  const task = createSampleTask(now, {
    id: 'loop-onboarding',
    handle: 'NW-155',
    projectId: PROJECT.id,
    title: 'Split store onboarding into steps',
    stage: latest.stage,
    stageReason: latest.stageReason,
    pullRequest: shown > 4 ? createPullRequest(now, 821, latest.pullRequest) : null,
    activity: visible.map((entry, index) => ({
      at: now - (visible.length - index) * 90_000,
      actor: entry.actor,
      kind: entry.kind,
      text: entry.text,
      detail: entry.detail ?? null,
      evidenceId: null,
    })),
  });
  return { state: createSampleState({ tasks: [task] }), task };
}
