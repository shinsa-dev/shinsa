import type { ReviewFinding } from '@shinsa/core';
import type { CodeSpotMark } from '@/lib/code/notes.ts';
import type { LineComment } from '@/lib/review/draft.ts';

export const SAMPLE_CODE_PATH = 'apps/web/src/lib/review/spots.ts';

export const SAMPLE_CODE_BEFORE = `import type { CodeSpot, PhaseHandOver } from '@shinsa/core';
import { ATTENTION } from '@/lib/tasks/status.ts';

export interface ReviewTarget {
  key: string;
  file: string;
  start: number;
  end: number;
  attention: CodeSpot['attention'];
}

const ORDER = { critical: 0, high: 1, normal: 2 } as const;

/* Targets are read once per report and kept in phase order. */
export function listReviewTargets(phases: PhaseHandOver[]): ReviewTarget[] {
  return phases.flatMap((phase, phaseIndex) =>
    phase.spots.map((spot, spotIndex) => ({
      key: \`\${phaseIndex}:\${spotIndex}\`,
      file: spot.file,
      start: spot.line,
      end: spot.end ?? spot.line,
      attention: spot.attention,
    }))
  );
}

export function sortByAttention(targets: ReviewTarget[]) {
  return [...targets].sort((a, b) => ORDER[a.attention] - ORDER[b.attention]);
}

export function groupByFile<T extends { file: string }>(items: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.file) ?? [];
    group.push(item);
    groups.set(item.file, group);
  }
  return [...groups.entries()].map(([file, members]) => ({ file, members }));
}

export function describeTarget(target: ReviewTarget) {
  const tone = ATTENTION[target.attention].tone;
  return \`\${target.file}:\${target.start} (\${tone})\`;
}
`;

export const SAMPLE_CODE_AFTER = `import type { CodeSpot, PhaseHandOver } from '@shinsa/core';
import { ATTENTION } from '@/lib/tasks/status.ts';

export interface ReviewSpot {
  key: string;
  file: string;
  start: number;
  end: number;
  attention: CodeSpot['attention'];
}

const ORDER = { critical: 0, high: 1, normal: 2 } as const;

/* Spots are read once per report and kept in phase order. */
export function listReviewSpots(phases: PhaseHandOver[]): ReviewSpot[] {
  return phases.flatMap((phase, phaseIndex) =>
    phase.spots.map((spot, spotIndex) => ({
      key: \`\${phaseIndex}:\${spotIndex}\`,
      file: spot.file,
      start: spot.line,
      end: spot.end ?? spot.line,
      attention: spot.attention,
    }))
  );
}

export function sortByAttention(spots: ReviewSpot[]) {
  return [...spots].sort((a, b) => ORDER[a.attention] - ORDER[b.attention]);
}

export function groupByFile<T extends { file: string }>(items: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.file) ?? [];
    group.push(item);
    groups.set(item.file, group);
  }
  return [...groups.entries()].map(([file, members]) => ({ file, members }));
}

export function describeSpot(spot: ReviewSpot) {
  const tone = ATTENTION[spot.attention].tone;
  return \`\${spot.file}:\${spot.start} (\${tone})\`;
}
`;

export const SAMPLE_CODE_FINDINGS: ReviewFinding[] = [
  {
    severity: 'blocking',
    file: SAMPLE_CODE_PATH,
    line: 19,
    title: 'A spot without a file opens a nameless file',
    message:
      'A spot without a file still becomes a spot here, and the Code tab then opens a file with no name.',
    fix: 'Skip spots without a file:\n\n```ts\nif (!spot.file) continue;\n```',
  },
  {
    severity: 'should_fix',
    file: SAMPLE_CODE_PATH,
    line: 33,
    end: 35,
    title: 'Equal attention keeps no fixed order',
    message:
      'Two targets of the same attention can swap places between renders, so J and K jump in a different order.',
    fix: 'Break the tie on the file and the start line.',
  },
  {
    severity: 'optional',
    file: SAMPLE_CODE_PATH,
    line: 42,
    end: 43,
    title: 'Move `describeSpot` next to its caller',
    message: '`describeSpot` is only used by the walkthrough; it could live next to it.',
  },
];

export const SAMPLE_CODE_COMMENTS: LineComment[] = [
  {
    id: 'sample-comment',
    path: SAMPLE_CODE_PATH,
    side: 'new',
    line: 28,
    endLine: null,
    ref: null,
    text: 'Sort without the copy: toSorted keeps the list as it was.',
  },
];

export const SAMPLE_CODE_SPOTS: CodeSpotMark[] = [
  {
    key: '0:0',
    from: 15,
    to: 24,
    tone: 'red',
    label: 'Critical: the spots are read in phase order',
    selected: true,
  },
];

export const SAMPLE_CODE_PATHS = [
  'apps/web/src/lib/review/spots.ts',
  'apps/web/src/lib/review/draft.ts',
  'apps/web/src/lib/review/findings.ts',
  'apps/web/src/lib/review/fallback-report.ts',
  'apps/web/src/lib/code/rank.ts',
  'apps/web/src/lib/code/tabs.ts',
  'apps/web/src/lib/code/tree.ts',
  'apps/web/src/lib/code/location.ts',
  'apps/web/src/lib/code/edits.ts',
  'apps/web/src/lib/code/editor/theme.ts',
  'apps/web/src/lib/code/editor/unified.ts',
  'apps/web/src/components/code/workbench.tsx',
  'apps/web/src/components/code/quick-open.tsx',
  'apps/web/src/components/code/editor-pane.tsx',
  'apps/web/src/components/code/review.tsx',
  'apps/web/src/routes/task/code.tsx',
  'packages/core/src/report/types.ts',
  'packages/core/src/report/validate.ts',
  'packages/core/src/prompts/fixes.ts',
  'packages/core/src/decide/gates.ts',
  'packages/ui/src/styles/globals.css',
  'docs/design.md',
  'docs/protocol.md',
];

export const SAMPLE_CODE_RECENT = ['apps/web/src/lib/review/spots.ts', 'apps/web/src/lib/review/draft.ts'];
