import type { Project, Repo, ReportCheck, ReviewFinding, ShinsaState, Task, WorkReport } from '@shinsa/core';
import { createSampleGate, createSampleState, createSampleTask, MINUTE } from '@/routes/ui/samples.ts';
import { lineOf, SHINSA_TASK_ID } from './demo-repo.ts';
import { listReviewEvidence } from './evidence-scene.ts';
import { BADGE_PATH, ROW_PATH, TINT_CHANGES, TONE_PATH } from './tint-code.ts';

const ROW = TINT_CHANGES[ROW_PATH].after;

const BADGE = TINT_CHANGES[BADGE_PATH].after;

const TONE = TINT_CHANGES[TONE_PATH].after;

function span(content: string, from: string, to: string) {
  return { start: lineOf(content, from), end: lineOf(content, to) };
}

const PROJECT: Project = {
  id: 'shinsa',
  name: 'Shinsa',
  color: 'purple',
  key: 'SW',
  description: 'Shinsa itself: the engine, the web app and the Mac app.',
  folders: ['~/Developer/shinsa'],
};

const REPO: Repo = {
  id: 'shinsa-repo',
  name: 'shinsa',
  path: '~/Developer/shinsa',
  defaultBranch: 'main',
  remote: 'github.com/shinsa-dev/shinsa',
  projectId: PROJECT.id,
  checkCommands: ['bun lint', 'bun check-types', 'bun run test'],
};

const FINDINGS: ReviewFinding[] = [
  {
    severity: 'suggestion',
    file: TONE_PATH,
    line: lineOf(TONE, 'export const TONE_SURFACE_HOVER'),
    title: 'The hover map has no test of its own',
    message:
      'Every tone has a hover step here, but nothing checks that a new tone added to `TONE_SURFACE` gets one too.',
    fix: 'Type both maps as `Record<Tone, string>` from one list of tones, so a missing entry fails the type check.',
  },
];

const CHECKS: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
  { name: 'bun run test', outcome: 'pass', detail: '1,835 tests' },
];

const REPORT: WorkReport = {
  headline:
    'All tasks colours each row’s kind icon by its status, and each pull request badge by its checks.',
  sections: [
    {
      title: 'Tint the kind icon by status',
      summary:
        'The kind icon in the Status column was always gray. It now takes the same tone as the status text beside it.',
      spots: [
        {
          file: ROW_PATH,
          ...span(ROW, 'function KindMark', 'TONE_TEXT[resolveTaskStatus'),
          attention: 'high',
          title: 'The mark reads the row’s status',
          explain:
            '`KindMark` now takes the state and colours its span with `TONE_TEXT` for the status the row already shows, so the icon and the words always agree.',
          why: 'Every row now computes its status twice: once for the text and once for the mark.',
        },
        {
          file: ROW_PATH,
          ...span(ROW, '<KindMark state={state} task={task} />', '<KindMark state={state} task={task} />'),
          attention: 'normal',
          why: 'The one caller passes the state through.',
        },
      ],
    },
    {
      title: 'Put the pull request badge on its tone',
      summary:
        'The badge sat on a gray chip whatever its checks said. It now sits on its tone’s soft surface, one step stronger on hover.',
      spots: [
        {
          file: BADGE_PATH,
          ...span(BADGE, 'const tone = resolvePullRequestTone', 'TONE_SURFACE_HOVER[tone]'),
          attention: 'high',
          title: 'Surface and hover from one tone',
          explain:
            'The tone is resolved once and drives both the resting surface and the hover step, so a failing pull request reads red before you find its row.',
          why: 'Replaces the hard-coded `bg-bg-a2` and `hover:bg-bg-a3`.',
        },
        {
          file: TONE_PATH,
          ...span(TONE, 'export const TONE_SURFACE_HOVER', "purple: 'hover:bg-purple-a3"),
          attention: 'normal',
          why: 'One hover step per tone, beside the surfaces it belongs to.',
        },
      ],
    },
  ],
  checks: CHECKS,
  judgementCalls: [
    {
      call: 'Coloured through the text tone, not an opacity',
      file: ROW_PATH,
      line: lineOf(ROW, 'TONE_TEXT[resolveTaskStatus'),
      reason:
        'Icons draw in a solid icon ink that their text colour sets, so the tone gives the icon its softer ink for free.',
      alternatives: [
        {
          option: 'The status colour at 70% opacity',
          rejected: 'The design system bans opacity on icons, and the conventions linter rejects it.',
        },
      ],
    },
    {
      call: 'A hover map beside the surfaces, not inline classes',
      file: TONE_PATH,
      line: lineOf(TONE, 'export const TONE_SURFACE_HOVER'),
      reason: 'Any other tinted chip that needs a hover gets it from the same place.',
      alternatives: [
        {
          option: 'Hover classes written in the badge',
          rejected: 'The next tinted chip would copy them and drift.',
        },
      ],
    },
  ],
  walkthrough: {
    approach:
      'Reuse the tones the rest of the app already has: the status text’s tone for the kind icon, and the pull request’s tone for its badge, with a matching hover step.',
    flow: 'Each roadmap row resolves its status with `resolveTaskStatus`, and `KindMark` colours itself with that tone. The badge resolves its pull request’s tone once and takes `TONE_SURFACE` at rest and `TONE_SURFACE_HOVER` under the pointer.',
    risks: [
      {
        risk: 'A neutral status keeps a gray icon, so a waiting task reads as quieter than before. That is the intent, but worth a look.',
        file: ROW_PATH,
        line: lineOf(ROW, 'TONE_TEXT[resolveTaskStatus'),
        end: lineOf(ROW, 'TONE_TEXT[resolveTaskStatus'),
      },
    ],
    testing: {
      automated: ['`row.test.tsx` checks the tinted kind mark and its tooltip on a roadmap row.'],
      manual: [
        {
          action: 'Open All tasks.',
          target: { kind: 'url', value: 'http://localhost:5181/tasks' },
          expect: 'Each kind icon matches the colour of its status.',
        },
        {
          action: 'Hover a pull request badge.',
          target: { kind: 'file', value: `${BADGE_PATH}:${lineOf(BADGE, 'TONE_SURFACE_HOVER')}` },
          expect: 'It steps one shade stronger in its own colour.',
        },
        {
          action: 'Switch to dark and find a failing pull request.',
          target: null,
          expect: 'The failing badge still reads red on its surface.',
        },
      ],
    },
  },
};

const DISAGREEMENTS = [
  {
    call: 'A hover map beside the surfaces, not inline classes',
    reason:
      'Only the badge uses it today; a second map is one more thing to keep in step with `TONE_SURFACE`.',
  },
];

export const TINT_TITLE = 'Tint the status icons and pull request badges on All tasks';

export function createTintState(now: number): { state: ShinsaState; task: Task } {
  const task = createSampleTask(now, {
    id: SHINSA_TASK_ID,
    handle: 'SW-214',
    projectId: PROJECT.id,
    repoId: REPO.id,
    title: TINT_TITLE,
    stage: 'awaiting_review',
    stageReason: 'changes to review',
    branch: 'feat/tinted-roadmap-icons',
    worktreePath: '~/.config/shinsa/data/worktrees/shinsa/SW-214',
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
    report: REPORT,
    findings: FINDINGS,
    reviewDisagreements: DISAGREEMENTS,
    checkResults: CHECKS,
    pullRequest: null,
  });
  const base = createSampleState({
    tasks: [task],
    gates: [
      createSampleGate(now, {
        id: 'review-shinsa-gate',
        taskId: task.id,
        type: 'review',
        title: 'Review the changes',
        openedAt: now - 6 * MINUTE,
      }),
    ],
  });
  const evidence = Object.fromEntries(listReviewEvidence(task.id, now).map((item) => [item.id, item]));
  return {
    task,
    state: {
      ...base,
      evidence,
      projects: { [PROJECT.id]: PROJECT },
      repos: { [REPO.id]: REPO },
    },
  };
}
