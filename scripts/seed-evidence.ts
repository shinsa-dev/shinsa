import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence, ShinsaEventInput } from '../packages/core/src/index.ts';
import { MINUTE } from './seed-kit.ts';

const MEDIA = join(import.meta.dirname, 'seed-media');

type SeedEvidence = Omit<Evidence, 'uri' | 'attachedAt' | 'taskId' | 'runId'> & {
  runId: string;
  minutesBeforeEnd: number;
  byShinsa?: true;
} & ({ file: string } | { name: string; text: string } | { url: string } | { check: string });

type StoredEvidence = Exclude<SeedEvidence, { url: string } | { check: string }>;

function resolveTaskId(runId: string) {
  return runId.replace(/-run-\d+$/, '');
}

function resolveName(piece: StoredEvidence) {
  return 'file' in piece ? piece.file : piece.name;
}

function resolveUri(piece: SeedEvidence) {
  if ('url' in piece) return piece.url;
  if ('check' in piece) return `shinsa://check/${piece.check}`;
  return `/api/evidence/${resolveTaskId(piece.runId)}/round-1/${resolveName(piece)}`;
}

function createCheckOutput(
  runId: string,
  checkId: string,
  title: string,
  text: string,
  minutesBeforeEnd = -0.5
): SeedEvidence {
  return {
    id: `evidence-${resolveTaskId(runId).replace(/^task-/, '')}-check-${checkId}`,
    runId,
    byShinsa: true,
    minutesBeforeEnd,
    kind: 'check',
    title,
    checkId,
    name: `check-${checkId}.txt`,
    text,
  };
}

const TAB_GROUP_TESTS = `$ bun test src/ui/tab-group.test.tsx
bun test v1.3.0

src/ui/tab-group.test.tsx:
✓ TabGroup > scrolls the active tab to the centre [4.12ms]
✓ TabGroup > keeps every tab at its natural width [1.87ms]

 2 pass
 0 fail
 6 expect() calls
Ran 2 tests across 1 file. [182.00ms]
`;

const REGISTRY_TESTS = `$ bun test src/cli
bun test v1.3.0

src/cli/help.test.ts:
✓ help > every command has help text [12.40ms]
✓ help > matches the recorded help of all 31 commands [8.91ms]

src/cli/parse.test.ts:
✓ parse > an unknown flag suggests the closest one [0.62ms]
✓ parse > deploy without an environment asks for it [0.41ms]

 4 pass
 0 fail
 38 expect() calls
Ran 4 tests across 2 files. [311.00ms]
`;

const QUEUE_TESTS = `$ bun test packages/core/test/queue
bun test v1.3.0

packages/core/test/queue/stack.test.ts:
✓ stackByPriority > puts urgent work on top and keeps the oldest first inside a priority [0.38ms]
✓ stackByPriority > leaves the input alone [0.07ms]

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [41.00ms]
`;

const SPOTS_TESTS = `$ bun test apps/web/test/lib/review
bun test v1.3.0

apps/web/test/lib/review/spots.test.ts:
✓ listReviewSpots > lists every spot of a recorded review in both orders [1.21ms]
✓ listReviewSpots > puts critical spots first when ordered by attention [0.34ms]
✓ stepSpot > wraps around at both ends [0.09ms]
✓ spot keys > round-trips a section and a spot [0.05ms]
✓ spot keys > ignores any other key [0.03ms]
✓ spot keys > shows one line without a range [0.04ms]

 6 pass
 0 fail
 17 expect() calls
Ran 6 tests across 1 file. [96.00ms]
`;

const DEFAULTS_TESTS = `$ bun test src/shared/defaults.test.ts
bun test v1.3.0

src/shared/defaults.test.ts:
✓ keeps the preferred model below 85%
✓ falls back at 85% of the window
✓ keeps the preferred model without usage data

 3 pass
 0 fail
`;

const LINT_OUTPUT = `$ bun lint
Checked 214 files in 412ms. No fixes applied.
`;

const TYPES_OUTPUT = `$ bun check-types
Tasks:    4 successful, 4 total
Time:    6.84s
`;

const CONTRAST_NOTE = `Contrast on the dark settings page, measured on \`#18191b\` against WCAG 2.2 for normal text. The tokens are in [src/client/theme.css](shinsa://file/src/client/theme.css#L14-L16).

| Token | Before | After | Needs |
| --- | --- | --- | --- |
| Hint text (\`--muted\`) | 2.6:1 | 6.9:1 | 4.5:1 |
| Borders (\`--border\`) | 1.2:1 | 1.6:1 | none, decorative |
| Disabled label (\`--disabled\`) | 1.6:1 | 3.5:1 | none, but it was unreadable |

Light mode reads the same tokens it did before, so nothing changes there.
`;

const SEED_EVIDENCE: SeedEvidence[] = [
  {
    id: 'evidence-contrast-1280-before',
    itemId: 'evidence-contrast-1280',
    runId: 'task-dark-contrast-run-0',
    minutesBeforeEnd: 5,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    detail: 'The hint text under each setting is hard to read.',
    width: 1280,
    theme: 'dark',
    stage: 'before',
    file: 'settings-1280-dark-before.png',
  },
  {
    id: 'evidence-contrast-1280-after',
    itemId: 'evidence-contrast-1280',
    runId: 'task-dark-contrast-run-0',
    minutesBeforeEnd: 1.5,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    detail: 'Hint text and borders now pass 4.5:1 against the panel.',
    width: 1280,
    theme: 'dark',
    stage: 'after',
    file: 'settings-1280-dark-after.png',
  },
  {
    id: 'evidence-contrast-390-before',
    itemId: 'evidence-contrast-390',
    runId: 'task-dark-contrast-run-0',
    minutesBeforeEnd: 4.8,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    width: 390,
    theme: 'dark',
    stage: 'before',
    file: 'settings-390-dark-before.png',
  },
  {
    id: 'evidence-contrast-390-after',
    itemId: 'evidence-contrast-390',
    runId: 'task-dark-contrast-run-0',
    minutesBeforeEnd: 1.3,
    kind: 'screenshot',
    title: 'Appearance settings, dark mode',
    width: 390,
    theme: 'dark',
    stage: 'after',
    file: 'settings-390-dark-after.png',
  },
  {
    id: 'evidence-contrast-light',
    runId: 'task-dark-contrast-run-0',
    minutesBeforeEnd: 1,
    kind: 'screenshot',
    title: 'Appearance settings, light mode',
    detail: 'Unchanged: the light tokens were not touched.',
    width: 1280,
    theme: 'light',
    file: 'settings-1280-light-after.png',
  },
  {
    id: 'evidence-contrast-ratios',
    runId: 'task-dark-contrast-run-1',
    minutesBeforeEnd: 0.5,
    kind: 'note',
    title: 'Contrast ratios, measured',
    detail: 'I measured each token on the dark panel myself.',
    name: 'contrast-ratios.md',
    text: CONTRAST_NOTE,
  },
  {
    id: 'evidence-contrast-disabled-before',
    itemId: 'evidence-contrast-disabled',
    runId: 'task-dark-contrast-run-2',
    minutesBeforeEnd: 2.5,
    kind: 'screenshot',
    title: 'Disabled settings, dark mode',
    detail: 'Syntax themes and Group by project are still faint.',
    width: 1280,
    theme: 'dark',
    stage: 'before',
    file: 'disabled-1280-dark-before.png',
  },
  {
    id: 'evidence-contrast-disabled-after',
    itemId: 'evidence-contrast-disabled',
    runId: 'task-dark-contrast-run-2',
    minutesBeforeEnd: 0.5,
    kind: 'screenshot',
    title: 'Disabled settings, dark mode',
    detail: 'Disabled labels are dimmer than the rest but readable.',
    width: 1280,
    theme: 'dark',
    stage: 'after',
    file: 'disabled-1280-dark-after.png',
  },
  {
    id: 'evidence-tabs-1280-before',
    itemId: 'evidence-tabs-1280',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 8,
    kind: 'screenshot',
    title: 'Screens tab group with 14 screens',
    detail: 'Every tab shrinks until its label is one or two letters.',
    width: 1280,
    theme: 'light',
    stage: 'before',
    file: 'tabs-1280-light-before.png',
  },
  {
    id: 'evidence-tabs-1280-after',
    itemId: 'evidence-tabs-1280',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 3,
    kind: 'screenshot',
    title: 'Screens tab group with 14 screens',
    detail: 'Tabs keep their labels and the row scrolls.',
    width: 1280,
    theme: 'light',
    stage: 'after',
    file: 'tabs-1280-light-after.png',
  },
  {
    id: 'evidence-tabs-recording',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 2.5,
    kind: 'recording',
    title: 'Scrolling the tab group and picking a tab',
    detail: 'Wheel scrolls the row; a picked tab glides to the centre.',
    width: 1280,
    theme: 'light',
    file: 'tabs-scroll-1280-light.webm',
  },
  {
    id: 'evidence-tabs-phone',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 2,
    kind: 'screenshot',
    title: 'Screens tab group on a phone',
    detail: 'Win-back offer picked: it sits in the centre with tabs on both sides.',
    width: 390,
    theme: 'light',
    file: 'tabs-390-light-after.png',
  },
  {
    id: 'evidence-tabs-tests',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 1,
    kind: 'test',
    title: 'Tab group scrolling',
    detail: 'Fails without the change: the active tab stays off screen.',
    checkId: 'c1',
    check: 'c1',
  },
  createCheckOutput('task-tab-scroll-run-0', 'c1', 'Tab group scrolling', TAB_GROUP_TESTS),
  createCheckOutput('task-tab-scroll-run-0', 'r1', 'bun lint', LINT_OUTPUT),
  createCheckOutput('task-tab-scroll-run-0', 'r2', 'bun check-types', TYPES_OUTPUT),
  {
    id: 'evidence-tabs-review-dark',
    runId: 'task-tab-scroll-run-1',
    minutesBeforeEnd: 1,
    kind: 'screenshot',
    title: 'Screens tab group in dark mode',
    detail: 'Checked dark mode at 900px myself: the selected tab still reads.',
    width: 900,
    theme: 'dark',
    file: 'tabs-900-dark-after.png',
  },
  {
    id: 'evidence-tabs-preview',
    runId: 'task-tab-scroll-run-0',
    minutesBeforeEnd: 0.8,
    kind: 'preview',
    title: 'Preview deployment',
    detail: 'The editor with this branch, seeded with the 14-screen paywall.',
    url: 'https://paywall-editor-git-fix-tab-group-scroll.vercel.app/paywalls/spring-sale',
  },
  {
    id: 'evidence-usage-defaults-test',
    runId: 'task-usage-defaults-run-0',
    minutesBeforeEnd: 1,
    kind: 'test',
    title: 'Model defaults',
    checkId: 'c1',
    check: 'c1',
  },
  createCheckOutput('task-usage-defaults-run-0', 'c1', 'Model defaults', DEFAULTS_TESTS),
  {
    id: 'evidence-registry-tests',
    runId: 'task-command-registry-run-1',
    minutesBeforeEnd: 1,
    kind: 'test',
    title: 'CLI help and flags',
    detail: 'The help snapshot fails without the registry and passes with it.',
    checkId: 'c1',
    check: 'c1',
  },
  createCheckOutput('task-command-registry-run-1', 'c1', 'CLI help and flags', REGISTRY_TESTS),
  {
    id: 'evidence-queue-tests',
    runId: 'task-sample-queue-run-2',
    minutesBeforeEnd: 1,
    kind: 'test',
    title: 'Queue order',
    checkId: 'c1',
    check: 'c1',
  },
  createCheckOutput('task-sample-queue-run-2', 'c1', 'Queue order', QUEUE_TESTS),
  {
    id: 'evidence-spots-review-light',
    itemId: 'evidence-spots-review',
    label: 'Light',
    runId: 'task-sample-review-run-3',
    minutesBeforeEnd: 3,
    kind: 'screenshot',
    title: 'Review tab stepping through spots',
    detail: 'Every point is a spot now; J and K step through them as before.',
    width: 1280,
    theme: 'light',
    file: 'review-spots-1280-light-after.png',
  },
  {
    id: 'evidence-spots-review-dark',
    itemId: 'evidence-spots-review',
    label: 'Dark',
    runId: 'task-sample-review-run-3',
    minutesBeforeEnd: 2.5,
    kind: 'screenshot',
    title: 'Review tab stepping through spots',
    detail: 'Every point is a spot now; J and K step through them as before.',
    width: 1280,
    theme: 'dark',
    file: 'review-spots-1280-dark-after.png',
  },
  {
    id: 'evidence-spots-tests',
    runId: 'task-sample-review-run-3',
    minutesBeforeEnd: 1,
    kind: 'test',
    title: 'Review spots',
    checkId: 'c1',
    check: 'c1',
  },
  createCheckOutput('task-sample-review-run-3', 'c1', 'Review spots', SPOTS_TESTS),
];

export function writeSeedEvidence(dataDir: string) {
  for (const piece of SEED_EVIDENCE) {
    if ('url' in piece || 'check' in piece) continue;
    const folder = join(dataDir, 'evidence', resolveTaskId(piece.runId), 'round-1');
    mkdirSync(folder, { recursive: true });
    const target = join(folder, resolveName(piece));
    if ('file' in piece) copyFileSync(join(MEDIA, piece.file), target);
    else writeFileSync(target, piece.text);
  }
}

export function listSeedEvidenceEvents(runEnds: ReadonlyMap<string, number>) {
  return SEED_EVIDENCE.flatMap(({ runId, minutesBeforeEnd, byShinsa, ...piece }) => {
    const end = runEnds.get(runId);
    if (end === undefined) return [];
    const attachedAt = end - minutesBeforeEnd * MINUTE;
    const {
      file: _file,
      name: _name,
      text: _text,
      url: _url,
      check: _check,
      ...fields
    } = piece as typeof piece &
      Partial<{ file: string; name: string; text: string; url: string; check: string }>;
    const event: ShinsaEventInput = {
      type: 'evidence.attached',
      evidence: {
        ...fields,
        taskId: resolveTaskId(runId),
        runId: byShinsa ? null : runId,
        uri: resolveUri({ runId, minutesBeforeEnd, ...piece }),
        attachedAt,
      },
    };
    return [{ at: attachedAt, event }];
  });
}
