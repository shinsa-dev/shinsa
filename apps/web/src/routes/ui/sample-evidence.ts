import type { Evidence, Task } from '@shinsa/core';
import { type EvidenceLayout, resolveEvidenceListLayout } from '@/lib/evidence/layout.ts';
import { type ChecksView, resolveChecksView } from '@/lib/tasks/checks.ts';
import { createSampleTask } from './samples.ts';

const SAMPLES = '/samples/evidence';

const TESTS = `bun test src/ui/tab-group.test.tsx
bun test v1.3.0

src/ui/tab-group.test.tsx:
✓ TabGroup > scrolls the active tab to the centre [4.12ms]
✓ TabGroup > keeps every tab at its natural width [1.87ms]

 2 pass
 0 fail
Ran 2 tests across 1 file. [182.00ms]`;

const CHECKS = `$ bun run lint
Checked 214 files in 412ms. No fixes applied.`;

const NOTE = `Contrast on the dark settings page, measured on \`#18191b\`. The tokens are in [src/client/theme.css](shinsa://file/src/client/theme.css#L14-L16).

| Token | Before | After | Needs |
| --- | --- | --- | --- |
| Hint text | 2.6:1 | 6.9:1 | 4.5:1 |
| Borders | 1.2:1 | 1.6:1 | none, decorative |`;

export const SAMPLE_EVIDENCE_TEXTS: readonly [string, string][] = [
  [`${SAMPLES}/tab-group-tests.txt`, TESTS],
  [`${SAMPLES}/checks.txt`, CHECKS],
  [`${SAMPLES}/contrast.md`, NOTE],
];

const PIECES: Omit<Evidence, 'taskId' | 'attachedAt'>[] = [
  {
    id: 'settings-before',
    itemId: 'settings',
    runId: null,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    detail: 'The hint text under each setting now passes 4.5:1 against the panel.',
    width: 800,
    theme: 'dark',
    stage: 'before',
    uri: `${SAMPLES}/settings-dark-before.png`,
  },
  {
    id: 'settings-after',
    itemId: 'settings',
    runId: null,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    detail: 'The hint text under each setting now passes 4.5:1 against the panel.',
    width: 800,
    theme: 'dark',
    stage: 'after',
    uri: `${SAMPLES}/settings-dark-after.png`,
  },
  {
    id: 'tabs-recording',
    runId: null,
    kind: 'recording',
    title: 'Scrolling the tab group and picking a tab',
    detail: 'Wheel scrolls the row; a picked tab glides to the centre.',
    width: 800,
    theme: 'light',
    uri: `${SAMPLES}/tabs-scroll.webm`,
  },
  {
    id: 'settings-light',
    runId: null,
    kind: 'screenshot',
    title: 'Disabled settings, dark mode',
    detail: 'Disabled labels are dimmer than the rest but readable.',
    width: 800,
    theme: 'dark',
    uri: `${SAMPLES}/settings-dark-after.png`,
  },
  {
    id: 'tab-group-link',
    runId: 'sample-run',
    kind: 'test',
    title: 'Tab group tests',
    detail: 'Covers centring the active tab and keeping every tab at its width.',
    uri: 'shinsa://check/c1',
    checkId: 'c1',
  },
  {
    id: 'tab-group-output',
    runId: null,
    kind: 'check',
    title: 'Tab group tests',
    uri: `${SAMPLES}/tab-group-tests.txt`,
    checkId: 'c1',
  },
  {
    id: 'lint-output',
    runId: null,
    kind: 'check',
    title: 'bun run lint',
    uri: `${SAMPLES}/checks.txt`,
    checkId: 'r1',
  },
  {
    id: 'contrast',
    runId: null,
    kind: 'note',
    title: 'Contrast ratios, measured',
    uri: `${SAMPLES}/contrast.md`,
  },
  {
    id: 'preview',
    runId: null,
    kind: 'preview',
    title: 'Preview deployment',
    uri: 'https://settings-contrast.preview.example.com',
  },
];

const EVIDENCE = PIECES.map((piece, at) => ({ ...piece, taskId: 'sample', attachedAt: at }));

const TASK: Task = createSampleTask(0, {
  id: 'sample',
  title: 'Centre the active tab',
  repoId: 'sample-repo',
  checks: [
    {
      id: 'c1',
      label: 'Tab group tests',
      command: 'bun test src/ui/tab-group.test.tsx',
      phases: [1],
      source: 'plan',
    },
  ],
  checkResults: [
    {
      id: 'c1',
      label: 'Tab group tests',
      command: 'bun test src/ui/tab-group.test.tsx',
      outcome: 'pass',
      detail: '2 pass',
    },
    { id: 'r1', label: 'bun run lint', command: 'bun run lint', outcome: 'pass', detail: null },
  ],
});

export const SAMPLE_EVIDENCE_CHECKS: ChecksView | null = resolveChecksView(
  {
    repos: {
      'sample-repo': {
        id: 'sample-repo',
        name: 'tabs',
        path: '/Users/you/Developer/tabs',
        defaultBranch: 'main',
        remote: null,
        projectId: null,
        checkCommands: ['bun run lint'],
      },
    },
    evidence: Object.fromEntries(EVIDENCE.map((piece) => [piece.id, piece])),
  },
  TASK
);

export const SAMPLE_EVIDENCE_LAYOUT: EvidenceLayout = {
  ...resolveEvidenceListLayout(EVIDENCE, {}),
  folder: '/Users/you/.config/shinsa/data/evidence/sample/round-1',
};
