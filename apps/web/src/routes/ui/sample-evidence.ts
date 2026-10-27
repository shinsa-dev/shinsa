import type { Evidence } from '@shinsa/core';
import { type EvidenceLayout, resolveEvidenceListLayout } from '@/lib/evidence/layout.ts';

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
Passed.
Checked 214 files in 412ms. No fixes applied.

$ bun run check-types
Passed.
Tasks:    6 successful, 6 total`;

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
    id: 'tab-group-tests',
    runId: null,
    kind: 'test',
    title: 'bun test src/ui/tab-group.test.tsx',
    uri: `${SAMPLES}/tab-group-tests.txt`,
  },
  {
    id: 'checks',
    runId: null,
    kind: 'check',
    title: 'Checks run by Shinsa: all 2 passed',
    detail: "Shinsa ran these in the task's worktree after the agent's work.",
    uri: `${SAMPLES}/checks.txt`,
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

export const SAMPLE_EVIDENCE_LAYOUT: EvidenceLayout = {
  ...resolveEvidenceListLayout(
    PIECES.map((piece, at) => ({ ...piece, taskId: 'sample', attachedAt: at })),
    {}
  ),
  folder: '/Users/you/.config/shinsa/data/evidence/sample/round-1',
};
