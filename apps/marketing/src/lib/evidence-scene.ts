import type { Evidence } from '@shinsa/core';
import { recordEvidenceText } from '@/lib/evidence/texts.ts';

const FOLDER = '/evidence';

const TESTS = `$ bun test test/components/roadmap
bun test v1.4.4

test/components/roadmap/row.test.tsx:
✓ the row context menu > offers Open task, priority, dependencies and the task actions [54.03ms]
✓ the row context menu > opens the task [26.15ms]
✓ the row context menu > changes the priority [21.31ms]
✓ the row context menu > stops waiting [17.65ms]
✓ the row context menu > shows the task a stacked task sits on as stacked, and keeps it when it stops waiting [138.78ms]
✓ the row context menu > cancels the task [17.76ms]
✓ the row context menu > offers only Open task on a settled task without a branch [6.00ms]
✓ the chain arrow > opens the Waits on menu without opening the task [13.67ms]
✓ the chain arrow > is only on a nested row [4.75ms]
✓ the chain arrow > opens a parent from the Waits on menu without opening the nested task [13.57ms]
✓ the chain arrow > keeps the task closed when Enter lands on the arrow [5.76ms]
✓ the repository column > says No repository for a task that works without one [0.94ms]
✓ the kind of task > marks every row with its kind, and its tooltip lists the steps the task takes [4.76ms]

 13 pass
 0 fail
 20 expect() calls
Ran 13 tests across 1 file. [519.00ms]`;

const CHECKS = `$ bun lint
Checked 1104 files in 1709ms. No fixes applied.
$ bun scripts/lint-conventions.ts

$ bun check-types
Tasks:    6 successful, 6 total

$ bun run test
 1835 pass
 0 fail
Ran 1835 tests across 214 files.`;

const TEXTS: [string, string][] = [
  [`${FOLDER}/roadmap-tests.txt`, TESTS],
  [`${FOLDER}/checks.txt`, CHECKS],
];

const LIGHT = {
  itemId: 'light',
  title: 'All tasks, light',
  detail: 'The kind icon takes its status colour, and the pull request badge sits on its tone.',
  width: 1280,
  theme: 'light' as const,
};

const DARK = {
  itemId: 'dark',
  title: 'All tasks, dark',
  detail: 'The same rows in dark: the failing pull request reads red before you find its row.',
  width: 1280,
  theme: 'dark' as const,
};

const PIECES: Omit<Evidence, 'taskId' | 'attachedAt'>[] = [
  {
    ...LIGHT,
    id: 'light-before',
    runId: null,
    kind: 'screenshot',
    stage: 'before',
    uri: `${FOLDER}/tasks-1280-light-before.png`,
  },
  {
    ...LIGHT,
    id: 'light-after',
    runId: null,
    kind: 'screenshot',
    stage: 'after',
    uri: `${FOLDER}/tasks-1280-light-after.png`,
  },
  {
    ...DARK,
    id: 'dark-before',
    runId: null,
    kind: 'screenshot',
    stage: 'before',
    uri: `${FOLDER}/tasks-1280-dark-before.png`,
  },
  {
    ...DARK,
    id: 'dark-after',
    runId: null,
    kind: 'screenshot',
    stage: 'after',
    uri: `${FOLDER}/tasks-1280-dark-after.png`,
  },
  {
    id: 'hover-recording',
    runId: null,
    kind: 'recording',
    title: 'Hovering the kind icons and the pull request badges',
    detail: 'Each badge steps one shade stronger on hover, in its own colour.',
    width: 1280,
    theme: 'light',
    uri: `${FOLDER}/tasks-hover-1280-light.webm`,
  },
  {
    id: 'roadmap-tests',
    runId: null,
    kind: 'test',
    title: 'bun test test/components/roadmap',
    detail: 'The kind-of-task test covers the tinted mark and its tooltip.',
    uri: `${FOLDER}/roadmap-tests.txt`,
  },
  {
    id: 'checks',
    runId: null,
    kind: 'check',
    title: 'Checks run by Shinsa: all 3 passed',
    detail: "Shinsa ran these in the task's worktree after the agent's work.",
    uri: `${FOLDER}/checks.txt`,
  },
  {
    id: 'preview',
    runId: null,
    kind: 'preview',
    title: 'All tasks on the worktree’s dev server',
    uri: 'http://localhost:5181/tasks',
  },
];

export function listReviewEvidence(taskId: string, now: number): Evidence[] {
  for (const [uri, body] of TEXTS) recordEvidenceText(uri, body);
  return PIECES.map((piece, index) => ({
    ...piece,
    taskId,
    attachedAt: now - (PIECES.length - index) * 60_000,
  }));
}
