import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  CodeSpot,
  Gate,
  JudgementCall,
  PhaseReport,
  PlanDocument,
  Project,
  Repo,
  ReportCheck,
  ReportWalkthrough,
  ReviewDisagreement,
  ReviewFinding,
  RunPurpose,
  RunRole,
  WorkReport,
} from '../packages/core/src/index.ts';
import { serializeReportMarkdown } from '../packages/core/src/index.ts';
import {
  bumpLockfileEntry,
  countLines,
  FIXTURE_SPOTS_PER_SECTION,
  type ImportCommit,
  insertAfterImports,
  insertBeforeLastHeading,
  type LockfileBump,
  type Rect,
  replaceAllRequired,
  replaceRequired,
  resolveLine,
  serializeFastImport,
  serializeRectsPng,
  serializeReviewFixture,
} from './seed-code-kit.ts';
import { DAY, HOUR, MINUTE, NOW, type Push, resolveAgentSession, type SeedTask } from './seed-kit.ts';

const SOURCE = join(import.meta.dir, '..');
const SOURCE_COMMIT = '359025295bdde05bff64cbdd711ee9bb1aee7956';
const PROJECT_ID = 'project-sample';
const REPO_ID = 'repo-shinsa-sample';
const REMOTE = 'git@github.com:shinsa-dev/shinsa-sample.git';
const FIXTURE_SECTIONS = 66;
const FIXTURE_SPOT_TOTAL = FIXTURE_SECTIONS * FIXTURE_SPOTS_PER_SECTION;

export const SAMPLE_REVIEW = 'task-sample-review';
export const SAMPLE_MERGED = 'task-sample-queue';
export const SAMPLE_LIVE = 'task-sample-theme';
export const SAMPLE_ANSWER = 'task-sample-answer';

export const SAMPLE_PATHS = {
  targets: 'apps/web/src/lib/review/targets.ts',
  spots: 'apps/web/src/lib/review/spots.ts',
  spotKeys: 'apps/web/src/lib/review/spot-keys.ts',
  targetsTest: 'apps/web/test/lib/review/targets.test.ts',
  spotsTest: 'apps/web/test/lib/review/spots.test.ts',
  review: 'apps/web/src/components/code/review.tsx',
  changes: 'apps/web/src/components/code/changes.tsx',
  codeView: 'apps/web/src/components/code/code-view.tsx',
  fixture: 'apps/web/test/fixtures/review-report.ts',
  design: 'docs/design.md',
  screenshot: 'docs/images/review.png',
  lockfile: 'bun.lock',
  webGuide: 'apps/web/CLAUDE.md',
  ranking: 'packages/core/src/report/markdown.ts',
  queueIndex: 'packages/core/src/queue/index.ts',
  queueStack: 'packages/core/src/queue/stack.ts',
  queueTest: 'packages/core/test/queue/stack.test.ts',
  tokens: 'packages/ui/src/styles/globals.css',
  highlight: 'apps/web/src/lib/code/highlight.ts',
  theme: 'apps/web/src/lib/code/theme.ts',
} as const;

export const REVIEW_AGE_HOURS = 5;
export const MERGED_AGE_HOURS = 30;
export const LIVE_AGE_HOURS = 0.7;
export const ANSWER_AGE_HOURS = 2;

export const REVIEW_MARKS = {
  planner: [1, 7],
  builders: [
    [7.5, 22],
    [22.5, 33],
    [33.5, 40],
  ],
  failedChecks: 43,
  fix: [43.5, 48],
  passedChecks: 51,
  reviewer: [51.5, 58],
} as const;

export const MERGED_MARKS = {
  planner: [1, 5],
  builders: [
    [5.5, 14],
    [14.5, 22],
  ],
  checks: 24,
  reviewer: [24.5, 28],
  approved: 95,
  pullRequest: 97,
  merge: 240,
} as const;

export const LIVE_MARKS = { planner: [0.5, 4], builder: [4.5, 16], working: 16.5 } as const;

export const ANSWER_MARKS = { answerer: [0.5, 3] } as const;

export const PULL_REQUEST_NUMBER = 12;

const RENAMES = [
  ['ReviewTarget', 'ReviewSpot'],
  ['toReviewTarget', 'toReviewSpot'],
  ['listReviewTargets', 'listReviewSpots'],
  ['listFindingTargets', 'listFindingSpots'],
  ['createDecisionTarget', 'createDecisionSpot'],
  ['stepTarget', 'stepSpot'],
  ['formatTargetLines', 'formatSpotLines'],
] as const;

const SPOT_KEYS = `export interface SpotKey {
  section: number;
  spot: number;
}

export function formatSpotKey(section: number, spot: number) {
  return \`\${section}:\${spot}\`;
}

export function parseSpotKey(value: string | null): SpotKey | null {
  if (!value) return null;
  const match = /^(\\d+):(\\d+)$/.exec(value);
  if (!match) return null;
  return { section: Number(match[1]), spot: Number(match[2]) };
}
`;

const SPOTS_TEST = `import { describe, expect, it } from 'bun:test';
import { formatSpotKey, parseSpotKey } from '@/lib/review/spot-keys.ts';
import { formatSpotLines, listReviewSpots, stepSpot } from '@/lib/review/spots.ts';
import { LARGE_REVIEW_REPORT, LARGE_REVIEW_TARGET_COUNT } from '../../fixtures/review-report.ts';

describe('listReviewSpots', () => {
  it('lists every spot of a recorded review in both orders', () => {
    expect(listReviewSpots(LARGE_REVIEW_REPORT, 'walkthrough')).toHaveLength(LARGE_REVIEW_TARGET_COUNT);
    expect(listReviewSpots(LARGE_REVIEW_REPORT, 'attention')).toHaveLength(LARGE_REVIEW_TARGET_COUNT);
  });

  it('puts critical spots first when ordered by attention', () => {
    const [first] = listReviewSpots(LARGE_REVIEW_REPORT, 'attention');
    expect(first?.attention).toBe('critical');
  });
});

describe('stepSpot', () => {
  it('wraps around at both ends', () => {
    const spots = listReviewSpots(LARGE_REVIEW_REPORT, 'walkthrough').slice(0, 3);
    expect(stepSpot(spots, 2, 1)?.key).toBe(spots[0]?.key);
    expect(stepSpot(spots, 0, -1)?.key).toBe(spots[2]?.key);
  });
});

describe('spot keys', () => {
  it('round-trips a section and a spot', () => {
    expect(parseSpotKey(formatSpotKey(3, 7))).toEqual({ section: 3, spot: 7 });
  });

  it('ignores any other key', () => {
    expect(parseSpotKey('finding:2')).toBeNull();
  });

  it('shows one line without a range', () => {
    const [spot] = listReviewSpots(LARGE_REVIEW_REPORT, 'walkthrough');
    if (!spot) throw new Error('The fixture has no spots.');
    expect(formatSpotLines({ ...spot, start: 4, end: 4 })).toBe('4');
  });
});
`;

const DESIGN_SECTION = `## Review spots

A spot is a line range a review points at, ranked critical, high or normal. The core, the agents and the web all call it
a spot; schedules and MCP servers keep the word target, which means something else there.

![The review walkthrough with its first spot spotlit](images/review.png)
`;

const QUEUE_STACK = `import { PRIORITY_RANK, type Task } from '../domain/index.ts';

export function stackByPriority<T extends { task: Task }>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] || a.task.createdAt - b.task.createdAt
  );
}
`;

const QUEUE_TEST = `import { describe, expect, test } from 'bun:test';
import type { Task, TaskPriority } from '../../src/index.ts';
import { stackByPriority } from '../../src/queue/index.ts';

function entry(id: string, priority: TaskPriority, createdAt: number) {
  return { task: { id, priority, createdAt } as Task };
}

describe('stackByPriority', () => {
  test('puts urgent work on top and keeps the oldest first inside a priority', () => {
    const stacked = stackByPriority([
      entry('low', 'low', 1),
      entry('late', 'high', 3),
      entry('urgent', 'urgent', 4),
      entry('early', 'high', 2),
    ]);
    expect(stacked.map(({ task }) => task.id)).toEqual(['urgent', 'early', 'late', 'low']);
  });

  test('leaves the input alone', () => {
    const entries = [entry('b', 'low', 2), entry('a', 'urgent', 1)];
    stackByPriority(entries);
    expect(entries.map(({ task }) => task.id)).toEqual(['b', 'a']);
  });
});
`;

const CODE_TOKENS = `
@layer base {
  :root {
    --code-keyword: oklch(0.5 0.19 290);
    --code-string: oklch(0.52 0.13 150);
    --code-number: oklch(0.58 0.15 55);
    --code-comment: oklch(0.6 0.01 260);
    --code-function: oklch(0.52 0.16 250);
    --code-type: oklch(0.56 0.12 200);
  }

  .dark {
    --code-keyword: oklch(0.78 0.14 295);
    --code-string: oklch(0.8 0.12 150);
    --code-number: oklch(0.82 0.12 60);
    --code-comment: oklch(0.64 0.01 260);
    --code-function: oklch(0.8 0.11 245);
    --code-type: oklch(0.82 0.09 200);
  }
}
`;

const CODE_THEME = `export const CODE_TOKEN_COLORS = {
  keyword: 'var(--code-keyword)',
  string: 'var(--code-string)',
  number: 'var(--code-number)',
  comment: 'var(--code-comment)',
  function: 'var(--code-function)',
  type: 'var(--code-type)',
} as const;

export type CodeTokenKind = keyof typeof CODE_TOKEN_COLORS;

const SCOPE_KINDS: [RegExp, CodeTokenKind][] = [
  [/^(keyword|storage)/, 'keyword'],
  [/^string/, 'string'],
  [/^constant\\.numeric/, 'number'],
  [/^comment/, 'comment'],
  [/^entity\\.name\\.function/, 'function'],
  [/^(entity\\.name\\.type|support\\.type)/, 'type'],
];

export function resolveTokenColor(scopes: readonly string[]) {
  for (const scope of scopes) {
    const kind = SCOPE_KINDS.find(([pattern]) => pattern.test(scope))?.[1];
    if (kind) return CODE_TOKEN_COLORS[kind];
  }
  return undefined;
}
`;

const SCREEN = { width: 640, height: 400 };

const PALETTE = {
  page: [250, 250, 249],
  rail: [241, 241, 239],
  line: [226, 226, 222],
  text: [120, 120, 116],
  code: [36, 36, 40],
  added: [214, 240, 222],
  critical: [232, 85, 70],
  high: [235, 160, 50],
  accent: [52, 110, 235],
} as const satisfies Record<string, Rect['color']>;

function listScreenRects(version: 'before' | 'after'): Rect[] {
  const rows = Array.from({ length: 9 }, (_, index) => index);
  const accent = version === 'after' ? PALETTE.accent : PALETTE.high;
  return [
    { x: 0, y: 0, width: 220, height: SCREEN.height, color: PALETTE.rail },
    { x: 220, y: 0, width: 1, height: SCREEN.height, color: PALETTE.line },
    ...rows.map((row) => ({
      x: 16,
      y: 24 + row * 36,
      width: 150 - ((row * 23) % 60),
      height: 10,
      color: row === 0 ? accent : PALETTE.text,
    })),
    ...rows.map((row) => ({
      x: 16,
      y: 40 + row * 36,
      width: 6,
      height: 6,
      color: row < 2 ? PALETTE.critical : PALETTE.high,
    })),
    { x: 221, y: version === 'after' ? 96 : 120, width: 419, height: 72, color: PALETTE.added },
    ...Array.from({ length: 22 }, (_, line) => ({
      x: 244 + ((line * 17) % 5) * 12,
      y: 20 + line * 16,
      width: 120 + ((line * 53) % 220),
      height: 6,
      color: PALETTE.code,
    })),
  ];
}

export function serializeReviewScreenshot(version: 'before' | 'after') {
  return serializeRectsPng(SCREEN.width, SCREEN.height, PALETTE.page, listScreenRects(version));
}

interface GitOptions {
  at?: number;
  index?: string;
  input?: string | Uint8Array;
}

function git(args: string[], cwd: string, options: GitOptions = {}) {
  const date = options.at === undefined ? null : `@${Math.floor(options.at / 1000)} +0000`;
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdin:
      typeof options.input === 'string'
        ? new TextEncoder().encode(options.input)
        : (options.input ?? 'ignore'),
    env: {
      ...Bun.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      ...(options.index ? { GIT_INDEX_FILE: options.index } : {}),
    },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function readText(root: string, path: string) {
  return readFileSync(join(root, path), 'utf8');
}

function writeText(root: string, path: string, content: string | Uint8Array) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commit(path: string, message: string, at: number, paths: readonly string[]) {
  git(['update-index', '--add', '--remove', '--', ...paths], path);
  const tree = git(['write-tree'], path);
  const sha = git(['commit-tree', tree, '-p', 'HEAD', '-m', message], path, { at });
  git(['update-ref', '-m', `commit: ${message}`, 'HEAD', sha], path);
  return { sha, tree };
}

function commitFiles(
  repo: string,
  parent: string,
  files: Record<string, string>,
  message: string,
  at: number
) {
  const scratch = mkdtempSync(join(tmpdir(), 'shinsa-seed-'));
  const index = join(scratch, 'index');
  try {
    git(['read-tree', parent], repo, { index });
    const entries = Object.entries(files).map(([path, content]) => {
      const blob = git(['hash-object', '-w', '--stdin'], repo, { input: content });
      return `100644 ${blob}\t${path}`;
    });
    git(['update-index', '--index-info'], repo, { index, input: `${entries.join('\n')}\n` });
    const tree = git(['write-tree'], repo, { index });
    return { sha: git(['commit-tree', tree, '-p', parent, '-m', message], repo, { at }), tree };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function listGrepMatches(path: string, query: string, ref = 'HEAD') {
  const result = Bun.spawnSync(['git', 'grep', '-n', '-F', query, ref, '--', 'apps', 'packages'], {
    cwd: path,
    env: { ...Bun.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  return result.stdout
    .toString()
    .trim()
    .split('\n')
    .map((line) => line.replace(`${ref}:`, ''))
    .slice(0, 14)
    .join('\n');
}

const HISTORY: { message: string; areas: string[] }[] = [
  { message: 'chore: set up the monorepo', areas: [] },
  { message: 'feat(ui): design tokens and the component kit', areas: ['packages/ui'] },
  { message: 'feat(core): events, commands and the decider', areas: ['packages/core'] },
  { message: 'feat(server): event log, effect runner and agent runs', areas: ['apps/server'] },
  { message: 'feat(web): task pages, the review and the chat', areas: ['apps/web'] },
  { message: 'docs: spec, engine, protocol and design', areas: ['docs', 'scripts'] },
];

const SEED_AUTHOR = 'Shinsa seed <seed@shinsa.dev>';

function extractSource(path: string) {
  const archive = Bun.spawnSync(['git', 'archive', '--format=tar', SOURCE_COMMIT], { cwd: SOURCE });
  if (archive.exitCode !== 0) throw new Error(`git archive: ${archive.stderr.toString()}`);
  const tar = Bun.spawnSync(['tar', '-x', '-C', path], { stdin: archive.stdout });
  if (tar.exitCode !== 0) throw new Error(`tar: ${tar.stderr.toString()}`);
  return git(['ls-tree', '-r', '-z', SOURCE_COMMIT], SOURCE)
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta = '', file = ''] = entry.split('\t');
      return { path: file, mode: meta.split(' ')[0] ?? '100644' };
    });
}

function resolveHistoryStep(path: string) {
  const index = HISTORY.findIndex(({ areas }) =>
    areas.some((area) => path === area || path.startsWith(`${area}/`))
  );
  return Math.max(0, index);
}

function commitHistory(path: string, files: { path: string; mode: string }[]) {
  const start = NOW - 12 * DAY;
  const fixture = serializeReviewFixture('target', FIXTURE_SECTIONS);
  const screenshot = serializeReviewScreenshot('before');
  writeText(path, SAMPLE_PATHS.fixture, fixture);
  writeText(path, SAMPLE_PATHS.screenshot, screenshot);
  const commits: ImportCommit[] = HISTORY.map((step, index) => ({
    message: step.message,
    at: start + index * DAY,
    files: files
      .filter((file) => resolveHistoryStep(file.path) === index)
      .map((file) => ({ ...file, content: readFileSync(join(path, file.path)) })),
  }));
  commits.push(
    {
      message: 'test(web): record a large review report as a fixture',
      at: start + 6 * DAY,
      files: [{ path: SAMPLE_PATHS.fixture, mode: '100644', content: new TextEncoder().encode(fixture) }],
    },
    {
      message: 'docs: screenshot of the review walkthrough',
      at: start + 7 * DAY,
      files: [{ path: SAMPLE_PATHS.screenshot, mode: '100644', content: screenshot }],
    }
  );
  git(['fast-import', '--quiet'], path, {
    input: serializeFastImport('refs/heads/main', SEED_AUTHOR, commits),
  });
  git(['reset', '-q'], path);
}

export interface FileChange {
  before: string;
  after: string;
}

export interface MergedNotes {
  worktree: string;
  index: FileChange;
  stack: string;
  test: string;
  head: string;
  mergeCommit: string;
  trees: string[];
}

function createMergedTask(repo: string, worktrees: string): MergedNotes {
  const start = NOW - MERGED_AGE_HOURS * HOUR;
  const at = (minutes: number) => start + minutes * MINUTE;
  const branch = 'feat/queue-priority-stack';
  const main = git(['rev-parse', 'main'], repo);
  const before = readText(repo, SAMPLE_PATHS.queueIndex);
  const after = `${before.trimEnd()}\nexport { stackByPriority } from './stack.ts';\n`;
  const first = commitFiles(
    repo,
    main,
    { [SAMPLE_PATHS.queueStack]: QUEUE_STACK, [SAMPLE_PATHS.queueIndex]: after },
    'feat: stack entries by priority',
    at(MERGED_MARKS.builders[0][1] - 0.2)
  );
  const second = commitFiles(
    repo,
    first.sha,
    { [SAMPLE_PATHS.queueTest]: QUEUE_TEST },
    'feat: cover the order with tests',
    at(MERGED_MARKS.builders[1][1] - 0.2)
  );
  git(['branch', branch, second.sha], repo);
  git(
    [
      'merge',
      '-q',
      '--no-ff',
      '-m',
      `Merge pull request #${PULL_REQUEST_NUMBER} from shinsa-dev/${branch}`,
      branch,
    ],
    repo,
    { at: at(MERGED_MARKS.merge) }
  );
  return {
    worktree: join(worktrees, SAMPLE_MERGED),
    index: { before, after },
    stack: QUEUE_STACK,
    test: QUEUE_TEST,
    head: second.sha,
    mergeCommit: git(['rev-parse', 'HEAD'], repo),
    trees: [first.tree, second.tree],
  };
}

export interface ReviewNotes {
  worktree: string;
  spots: FileChange;
  spotsRenamed: string;
  spotKeys: FileChange;
  spotsTest: FileChange;
  targetsTest: string;
  review: FileChange;
  changes: FileChange;
  codeView: FileChange;
  fixture: FileChange;
  design: FileChange;
  webGuide: FileChange;
  ranking: string;
  lock: LockfileBump;
  importers: string;
  diffStat: string;
  trees: string[];
}

function renameModule(worktree: string) {
  const targets = readText(worktree, SAMPLE_PATHS.targets);
  git(['mv', SAMPLE_PATHS.targets, SAMPLE_PATHS.spots], worktree);
  const renamed = replaceAllRequired(
    targets,
    [...RENAMES, ['targets', 'spots'], ['target', 'spot']],
    SAMPLE_PATHS.targets
  );
  const keyed = replaceRequired(
    renamed,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the template literal the rename replaces in the sample file
    '`${sectionIndex}:${spotIndex}`',
    'formatSpotKey(sectionIndex, spotIndex)',
    SAMPLE_PATHS.targets
  );
  const spots = insertAfterImports(keyed, "import { formatSpotKey } from './spot-keys.ts';");
  writeText(worktree, SAMPLE_PATHS.spots, spots);
  writeText(worktree, SAMPLE_PATHS.spotKeys, SPOT_KEYS);
  const targetsTest = readText(worktree, SAMPLE_PATHS.targetsTest);
  rmSync(join(worktree, SAMPLE_PATHS.targetsTest));
  writeText(worktree, SAMPLE_PATHS.spotsTest, SPOTS_TEST);
  const lock = bumpLockfileEntry(readText(worktree, SAMPLE_PATHS.lockfile));
  writeText(worktree, SAMPLE_PATHS.lockfile, lock.content);
  return { spots: { before: targets, after: spots }, spotsRenamed: keyed, targetsTest, lock };
}

function updateCallers(worktree: string) {
  const callers = [SAMPLE_PATHS.review, SAMPLE_PATHS.changes, SAMPLE_PATHS.codeView].map((path) => {
    const before = readText(worktree, path);
    const moved = replaceRequired(before, '@/lib/review/targets.ts', '@/lib/review/spots.ts', path);
    const after = RENAMES.reduce(
      (text, [from, to]) => (text.includes(from) ? replaceRequired(text, from, to, path) : text),
      moved
    );
    writeText(worktree, path, after);
    return { before, after };
  });
  const fixture = {
    before: readText(worktree, SAMPLE_PATHS.fixture),
    after: serializeReviewFixture('spot', FIXTURE_SECTIONS),
  };
  writeText(worktree, SAMPLE_PATHS.fixture, fixture.after);
  const testAfter = replaceRequired(
    SPOTS_TEST,
    'LARGE_REVIEW_TARGET_COUNT',
    'LARGE_REVIEW_SPOT_COUNT',
    SAMPLE_PATHS.spotsTest
  );
  writeText(worktree, SAMPLE_PATHS.spotsTest, testAfter);
  const [review, changes, codeView] = callers as [FileChange, FileChange, FileChange];
  return { review, changes, codeView, fixture, spotsTest: { before: SPOTS_TEST, after: testAfter } };
}

function createReviewTask(repo: string, worktrees: string): ReviewNotes {
  const start = NOW - REVIEW_AGE_HOURS * HOUR;
  const at = (minutes: number) => start + minutes * MINUTE;
  const worktree = join(worktrees, SAMPLE_REVIEW);
  const importers = listGrepMatches(repo, 'lib/review/targets.ts');
  const ranking = readText(repo, SAMPLE_PATHS.ranking);
  git(['worktree', 'add', '-q', '-b', 'refactor/review-spots', worktree, 'main'], repo);
  const [phase0, phase1, phase2] = REVIEW_MARKS.builders;

  const renamed = renameModule(worktree);
  const trees = [
    commit(worktree, 'refactor: rename the module', at(phase0[1] - 0.2), [
      SAMPLE_PATHS.spots,
      SAMPLE_PATHS.spotKeys,
      SAMPLE_PATHS.targetsTest,
      SAMPLE_PATHS.spotsTest,
      SAMPLE_PATHS.lockfile,
    ]).tree,
  ];

  const callers = updateCallers(worktree);
  trees.push(
    commit(worktree, 'refactor: update the callers', at(phase1[1] - 0.2), [
      SAMPLE_PATHS.review,
      SAMPLE_PATHS.changes,
      SAMPLE_PATHS.codeView,
      SAMPLE_PATHS.fixture,
      SAMPLE_PATHS.spotsTest,
    ]).tree
  );

  const design = { before: readText(worktree, SAMPLE_PATHS.design), after: '' };
  design.after = insertBeforeLastHeading(design.before, DESIGN_SECTION);
  writeText(worktree, SAMPLE_PATHS.design, design.after);
  writeText(worktree, SAMPLE_PATHS.screenshot, serializeReviewScreenshot('after'));
  trees.push(
    commit(worktree, 'refactor: update the docs', at(phase2[1] - 0.2), [
      SAMPLE_PATHS.design,
      SAMPLE_PATHS.screenshot,
    ]).tree
  );

  const spotKeys = {
    before: SPOT_KEYS,
    after: replaceRequired(SPOT_KEYS, 'export interface SpotKey', 'interface SpotKey', SAMPLE_PATHS.spotKeys),
  };
  writeText(worktree, SAMPLE_PATHS.spotKeys, spotKeys.after);
  trees.push(
    commit(worktree, 'fix: make the checks pass', at(REVIEW_MARKS.fix[1] - 0.2), [SAMPLE_PATHS.spotKeys]).tree
  );
  const diffStat = git(['diff', '--stat', '--find-renames', 'main'], worktree);

  const guide = readText(worktree, SAMPLE_PATHS.webGuide);
  const webGuide = {
    before: guide,
    after: replaceRequired(
      guide,
      'Review targets and markers',
      'Review spots and markers',
      SAMPLE_PATHS.webGuide
    ),
  };
  writeText(worktree, SAMPLE_PATHS.webGuide, webGuide.after);
  return {
    worktree,
    ...renamed,
    ...callers,
    spotKeys,
    design,
    webGuide,
    ranking,
    importers,
    diffStat,
    trees,
  };
}

export interface LiveNotes {
  worktree: string;
  theme: string;
  tokens: FileChange;
  highlight: FileChange;
  trees: string[];
}

function createLiveTask(repo: string, worktrees: string): LiveNotes {
  const start = NOW - LIVE_AGE_HOURS * HOUR;
  const worktree = join(worktrees, SAMPLE_LIVE);
  git(['worktree', 'add', '-q', '-b', 'feat/code-view-dark-theme', worktree, 'main'], repo);
  const tokensBefore = readText(worktree, SAMPLE_PATHS.tokens);
  const tokens = { before: tokensBefore, after: `${tokensBefore.trimEnd()}\n${CODE_TOKENS}` };
  writeText(worktree, SAMPLE_PATHS.tokens, tokens.after);
  const first = commit(
    worktree,
    'feat: add the code tokens',
    start + (LIVE_MARKS.builder[1] - 0.2) * MINUTE,
    [SAMPLE_PATHS.tokens]
  );
  writeText(worktree, SAMPLE_PATHS.theme, CODE_THEME);
  const highlightBefore = readText(worktree, SAMPLE_PATHS.highlight);
  const highlight = {
    before: highlightBefore,
    after: insertAfterImports(highlightBefore, "import { resolveTokenColor } from './theme.ts';"),
  };
  writeText(worktree, SAMPLE_PATHS.highlight, highlight.after);
  return { worktree, theme: CODE_THEME, tokens, highlight, trees: [first.tree] };
}

export interface CodeSample {
  project: Project;
  repo: Repo;
  merged: MergedNotes;
  review: ReviewNotes;
  live: LiveNotes;
}

export function createCodeSample(repos: string, worktrees: string): CodeSample {
  const path = join(repos, 'shinsa-sample');
  mkdirSync(path, { recursive: true });
  git(['init', '-q', '-b', 'main'], path);
  git(['config', 'user.email', 'seed@shinsa.dev'], path);
  git(['config', 'user.name', 'Shinsa seed'], path);
  commitHistory(path, extractSource(path));
  const merged = createMergedTask(path, worktrees);
  const review = createReviewTask(path, worktrees);
  const live = createLiveTask(path, worktrees);
  return {
    project: {
      id: PROJECT_ID,
      name: 'Sample',
      color: 'orange',
      key: 'SMP',
      description:
        'A snapshot of Shinsa’s own code, to try the code views on a real repository: about a thousand files, a review, a merged change and one in progress.',
      folders: [],
    },
    repo: {
      id: REPO_ID,
      name: 'shinsa-sample',
      path,
      defaultBranch: 'main',
      remote: REMOTE,
      projectId: PROJECT_ID,
      checkCommands: ['bun lint', 'bun check-types', 'bun run test', 'bunx knip'],
    },
    merged,
    review,
    live,
  };
}

function runId(taskId: string, index: number) {
  return `${taskId}-run-${index}`;
}

interface SampleRun {
  taskId: string;
  index: number;
  role: RunRole;
  purpose?: RunPurpose;
  from: number;
  to: number | null;
  summary: string;
  phaseIndex?: number;
}

function pushRun(push: Push, run: SampleRun) {
  const id = runId(run.taskId, run.index);
  push(run.from, {
    type: 'run.started',
    run: {
      id,
      taskId: run.taskId,
      role: run.role,
      ...(run.purpose ? { purpose: run.purpose } : {}),
      provider: 'claude',
      model: run.role === 'reviewer' ? 'claude-sonnet-5-5' : 'claude-opus-5-5',
      sessionId: run.role === 'agent' ? resolveAgentSession(run.taskId) : `session-${run.taskId}-${run.role}`,
      sessionProvider: 'claude',
      ...(run.role === 'agent' && run.index > 0 ? { resume: true } : {}),
      startedAt: run.from,
      endedAt: null,
      outcome: null,
      summary: null,
      status: 'running',
      ...(run.phaseIndex === undefined ? {} : { phaseIndex: run.phaseIndex }),
    },
  });
  if (run.to === null) return;
  push(run.to, { type: 'run.ended', runId: id, outcome: 'completed', summary: run.summary });
}

function stage(push: Push, taskId: string, at: number, next: SeedTask['stage'], reason: string) {
  push(at, { type: 'task.staged', taskId, stage: next, reason });
}

function pushPhase(
  push: Push,
  taskId: string,
  index: number,
  [from, to]: readonly [number, number],
  phase: SamplePhase & { tree: string }
) {
  const report: PhaseReport = {
    index,
    runId: runId(taskId, index + 1),
    summary: phase.summary,
    spots: phase.spots,
    judgementCalls: phase.judgementCalls,
    walkthrough: phase.walkthrough ?? null,
    at: to - 0.3 * MINUTE,
  };
  push(from + 0.1 * MINUTE, { type: 'phase.updated', taskId, index, status: 'active' });
  push(to - 0.3 * MINUTE, { type: 'phase.completed', taskId, report });
  push(to - 0.25 * MINUTE, { type: 'phase.updated', taskId, index, status: 'done' });
  push(to - 0.2 * MINUTE, { type: 'work.committed', taskId, treeHash: phase.tree });
}

function openGate(
  push: Push,
  at: number,
  gate: Omit<Gate, 'status' | 'openedAt' | 'answeredAt' | 'decision' | 'response'>
) {
  push(at, {
    type: 'gate.opened',
    gate: { ...gate, status: 'open', openedAt: at, answeredAt: null, decision: null, response: null },
  });
}

export interface SamplePhase {
  summary: string;
  spots: CodeSpot[];
  judgementCalls: JudgementCall[];
  walkthrough?: ReportWalkthrough | null;
}

interface SpotDetail {
  title: string;
  explain: string;
}

function spotIn(
  file: string,
  content: string,
  from: string,
  to: string,
  attention: CodeSpot['attention'],
  why: string,
  detail?: SpotDetail
): CodeSpot {
  const start = resolveLine(content, from);
  return { file, start, end: resolveLine(content, to, start - 1), attention, why, ...detail };
}

function placeIn(file: string, content: string, from: string, to = from) {
  const line = resolveLine(content, from);
  return { file, line, end: resolveLine(content, to, line - 1) };
}

function riskIn(title: string, risk: string, file: string, content: string, from: string, to = from) {
  return { title, risk, ...placeIn(file, content, from, to) };
}

function withWalkthrough(phases: SamplePhase[], walkthrough: ReportWalkthrough): SamplePhase[] {
  return phases.map((phase, index) => (index === phases.length - 1 ? { ...phase, walkthrough } : phase));
}

function assembleReport(
  plan: PlanDocument,
  phases: SamplePhase[],
  checks: ReportCheck[],
  walkthrough: ReportWalkthrough
): WorkReport {
  return {
    headline: plan.goal,
    sections: phases.map((phase, index) => ({
      title: plan.phases[index]?.title ?? `Phase ${index + 1}`,
      summary: phase.summary,
      spots: phase.spots,
    })),
    checks,
    judgementCalls: phases.flatMap((phase) => phase.judgementCalls),
    walkthrough,
  };
}

export const REVIEW_PLAN: PlanDocument = {
  goal: 'The web app calls the places a review points at spots, as the core and the agents already do, so one word means one thing from the hand-over to the screen.',
  phases: [
    {
      title: 'Rename the module',
      detail:
        'Move lib/review/targets.ts to spots.ts, rename its types and functions, and rewrite its tests.',
    },
    {
      title: 'Update the callers',
      detail:
        'Point the review, the changes list and the code view at the new names, and the recorded fixture.',
    },
    { title: 'Update the docs', detail: 'The design doc and its screenshot use the new word.' },
  ],
  behaviour: [
    'The walkthrough, the by-attention order and the finding markers behave exactly as before.',
    'A link with a section and spot key opens the same spot as before.',
  ],
  approach:
    'A rename with no behaviour change. Spot keys move into their own small module so the review and its links build them the same way. The tests are rewritten against the public functions and the recorded fixture of every spot kind instead of being renamed line by line.',
  files: [
    { path: SAMPLE_PATHS.spots, change: 'Renamed from targets.ts; ReviewTarget becomes ReviewSpot.' },
    { path: SAMPLE_PATHS.spotKeys, change: 'New: format and parse a section and spot key.' },
    { path: SAMPLE_PATHS.review, change: 'Imports the new names.' },
    { path: SAMPLE_PATHS.changes, change: 'Imports the new module.' },
    { path: SAMPLE_PATHS.codeView, change: 'Imports CodeMarker from the new module.' },
    { path: SAMPLE_PATHS.design, change: 'A short section on review spots, with a new screenshot.' },
  ],
  outOfScope: ['Schedule targets and MCP server targets, which are a different idea.'],
  verification: [
    'The review tests pass against the recorded fixture.',
    'The walkthrough looks the same by hand.',
  ],
  questions: [],
};

const PARSE_CALL = 'parseSpotKey reads section and spot keys only';
const TESTS_CALL = 'Rewrote the tests instead of renaming them';

function countTests(content: string) {
  return content.split('\n').filter((line) => /^\s+it\(/.test(line)).length;
}

function describeReviewFlow(review: ReviewNotes) {
  const handBuilt = resolveLine(review.review.after, 'const target = toReviewSpot(spot, section.title');
  return [
    'A spot starts in the agent’s hand-over and ends as a focused range in the Code tab:',
    '',
    '```text',
    'complete_phase { spots }            the agent’s hand-over',
    '        │',
    '        ▼',
    'WorkReport.sections[s].spots[i]     core keeps the agent’s order',
    '        │',
    '        ├─ walkthrough ────▶ review.tsx builds s:i by hand',
    '        ├─ by attention ───▶ listRankedSpots ─▶ formatSpotKey(s, i)',
    '        ├─ + findings ─────▶ listFindingSpots ─▶ finding:n',
    '        ▼',
    'ReviewPane   one list, stepSpot     selectedKey picks the row',
    '        │',
    '        ▼',
    'CodePane ──▶ CodeView focus { start, end } + listFindingMarkers',
    '',
    'a link with a key ──▶ parseSpotKey ──▶ { section, spot } or null',
    '```',
    '',
    '1. `complete_phase` carries each spot as a file, a line range and an attention. Core stores the spots per section in the report, in the order the agent wrote them.',
    `2. In walkthrough order the review renders each section itself and keys a row \`s:i\` with a template literal (review.tsx line ${handBuilt}). By attention, \`listReviewSpots\` sorts through core’s \`listRankedSpots\` and keys with \`formatSpotKey\`. Both give the same string, so the selection survives switching.`,
    '3. `ReviewPane` appends the finding rows from `listFindingSpots`, keyed `finding:n`, and `stepSpot` wraps around the joined list. A judgement call opens `createDecisionSpot`, keyed `decision:file:line`, which sits outside that list.',
    '4. `CodePane` finds the spot’s file in the diff and hands `CodeView` the range to focus. Finding markers land on the last line each finding points at.',
    '5. A link carrying a key goes through `parseSpotKey`, which accepts `s:i` and nothing else.',
  ].join('\n');
}

function describeReviewWalkthrough(review: ReviewNotes): ReportWalkthrough {
  const lock = review.lock;
  return {
    approach: [
      'The web was the last layer that said target for what core and the agents call a spot, so this is a rename with one structural change.',
      '',
      '`lib/review/targets.ts` moves to `spots.ts` with `git mv`, so its history follows, and seven exported names change (`ReviewTarget` to `ReviewSpot`, `listReviewTargets` to `listReviewSpots` and so on). The three callers and the recorded fixture follow in phase 2 and the design doc in phase 3, one commit each, so every commit reads on its own.',
      '',
      `The structural change: the \`section:spot\` key was a template literal in two places. It now comes from \`formatSpotKey\` in a new \`spot-keys.ts\`, beside \`parseSpotKey\`, which reads a key back from a link. The ${countLines(review.targetsTest)}-line test file is replaced by ${countLines(review.spotsTest.after)} lines against the public functions and the recorded fixture.`,
    ].join('\n'),
    flow: describeReviewFlow(review),
    risks: [
      riskIn(
        'No caller for parseSpotKey yet',
        'Nothing in the app calls `parseSpotKey` yet; only the test does. Whatever reads review links next inherits the null for finding and decision keys.',
        SAMPLE_PATHS.spotKeys,
        review.spotKeys.after,
        'export function parseSpotKey',
        'return { section'
      ),
      riskIn(
        'Walkthrough keys built by hand',
        'The walkthrough still builds its keys by hand. If `formatSpotKey` ever changes, the selection is lost each time you switch between walkthrough and by attention.',
        SAMPLE_PATHS.review,
        review.review.after,
        'const target = toReviewSpot(spot, section.title'
      ),
      riskIn(
        'Finding keys can shift',
        'Finding keys are an index into `task.findings`. After a second agent review the same key can open a different finding.',
        SAMPLE_PATHS.spots,
        review.spots.after,
        'key: `finding:'
      ),
      riskIn(
        'Colons in decision keys',
        'Decision keys hold a file path, and a path can contain a colon. A parser that splits on the first colon would read the wrong line.',
        SAMPLE_PATHS.spots,
        review.spots.after,
        'key: `decision:'
      ),
      riskIn(
        'Finding rows lost their tests',
        '`listFindingMarkers`, `listFindingSpots` and `createDecisionSpot` lost their direct tests with targets.test.ts. A mistake in the finding rows would not fail a test.',
        SAMPLE_PATHS.spots,
        review.spots.after,
        'export function listFindingMarkers',
        'finding.file === file'
      ),
      {
        title: 'Lockfile bump inside a rename',
        risk: `bun.lock moves ${lock.name} from ${lock.from} to ${lock.to}. Small, but it ships inside a rename and changes what a fresh install builds.`,
        file: SAMPLE_PATHS.lockfile,
        line: lock.line,
        end: lock.line,
      },
      {
        title: 'Binary screenshot change',
        risk: 'docs/images/review.png is a binary change. The diff cannot show it, so open it beside the old one.',
        file: SAMPLE_PATHS.screenshot,
        line: null,
        end: null,
      },
    ],
    testing: {
      automated: [
        '`bun test apps/web/test/lib/review`: six tests against the recorded fixture, covering both orders, critical first, wrap-around stepping and the key round trip.',
        '`bunx knip` passes now that `SpotKey` is no longer exported; it failed on the first run of the checks.',
      ],
      manual: [
        {
          file: SAMPLE_PATHS.lockfile,
          start: lockLine,
          end: lockLine,
          attention: 'normal',
          why: `bun install re-resolved ${review.lock.name} from ${review.lock.from} to ${review.lock.to}. No dependency was added.`,
        },
        {
          action: 'Open this task’s Code tab and the Review beside it.',
          target: { kind: 'url', value: 'http://localhost:5181/tasks/SMP-2?tab=code' },
          expect: 'The Review lists the spots in walkthrough order, the first one selected.',
        },
        {
          action: 'Step with next until you pass the last finding, then step back with previous.',
          target: null,
          expect:
            'After the last finding it wraps back to the first spot, and previous walks the same path backwards.',
        },
        {
          action: 'Pick a spot, switch to By attention and back.',
          target: null,
          expect: 'The same spot stays selected, because both lists key it as section:spot.',
        },
        {
          action: 'Click a judgement call’s place, then press next.',
          target: null,
          expect: 'The code pane opens that line, and next goes back to the first spot.',
        },
        {
          action: 'Open a link with a finding key such as `finding:0`, then read how keys are parsed.',
          target: {
            kind: 'file',
            value: `${SAMPLE_PATHS.spotKeys}:${resolveLine(review.spotKeys.after, 'export function parseSpotKey')}-${resolveLine(review.spotKeys.after, 'return { section')}`,
          },
          expect:
            'The link opens nothing: `parseSpotKey` accepts only `s:i` keys and returns null for the rest.',
        },
      ],
    },
  };
}

function listRenamePhase(review: ReviewNotes): SamplePhase {
  const lock = review.lock;
  return {
    summary:
      'targets.ts is now spots.ts with ReviewSpot and the matching function names. Spot keys live in spot-keys.ts. The old tests are replaced by smaller ones against the recorded fixture.',
    spots: [
      spotIn(
        SAMPLE_PATHS.spotKeys,
        review.spotKeys.after,
        'export function parseSpotKey',
        'return { section',
        'critical',
        'Only section and spot keys parse. A finding or judgement call key from an older link comes back as null.',
        {
          title: 'parseSpotKey reads a key back from a link',
          explain:
            'The regex accepts two runs of digits around one colon and returns them as numbers. Anything else, an empty value included, is `null`, so a caller treats no key and a key it does not know the same way. `finding:2` and `decision:path:line` both land in that null.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.spotKeys,
        review.spotKeys.after,
        'export function formatSpotKey',
        'return `',
        'high',
        'Every list keyed by section and spot has to build its key here, or the selection breaks when the order switches.',
        {
          title: 'One function builds a spot key',
          explain:
            '`formatSpotKey(section, spot)` returns `section:spot`, the same string the template literal in targets.ts produced, so nothing keyed before the rename changes. It sits beside `parseSpotKey` so the writer and the reader of the format change together.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.spots,
        review.spots.after,
        'export interface ReviewSpot',
        'section: string',
        'normal',
        'Only the name changed. Anything still typed as ReviewTarget fails to compile, so no caller can be missed.',
        {
          title: 'ReviewSpot, the row the review steps through',
          explain:
            'A `CodeSpot` from core plus the two fields the web adds: `key`, which identifies the row for selection, and `section`, the phase title the by-attention list shows. `toReviewSpot` spreads the core spot in, so a new field on `CodeSpot` reaches the web without a change here.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.spots,
        review.spots.after,
        "if (order === 'attention')",
        'formatSpotKey(sectionIndex',
        'high',
        'The by-attention order still comes from listRankedSpots in core; only the names and the key format changed.',
        {
          title: 'By attention borrows core’s ranking',
          explain:
            '`listRankedSpots` returns each spot with the indexes it had in the report. The key is built from those indexes, not from the sorted position, so a spot keeps one key in both orders and the selection survives switching.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.spots,
        review.spots.after,
        'export function listFindingSpots',
        'key: `finding:',
        'high',
        'Finding keys are positional. A second review that reorders its findings makes an old finding link open another finding.',
        {
          title: 'Findings join the list with a key of their own',
          explain:
            'Located findings become rows too, critical when blocking and high otherwise, keyed `finding:` plus their index in `task.findings`. That is the key `parseSpotKey` now rejects.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.spots,
        review.spots.after,
        'export function createDecisionSpot',
        'key: `decision:',
        'high',
        'The key embeds a file path, so any parser that splits it on a colon has to take the last part as the line.',
        {
          title: 'A judgement call opens a one-line spot',
          explain:
            '`createDecisionSpot` makes a spot on the single line a judgement call names. It never joins the stepping list: `ReviewPane` holds it apart and drops it on the next selection.',
        }
      ),
      {
        file: SAMPLE_PATHS.lockfile,
        start: lock.line,
        end: lock.line,
        attention: 'normal',
        why: `bun install re-resolved ${lock.name} from ${lock.from} to ${lock.to}. No dependency was added.`,
      },
      spotIn(
        SAMPLE_PATHS.ranking,
        review.ranking,
        '.sort(',
        'a.spotIndex - b.spotIndex',
        'normal',
        'Not changed: core already calls these spots. This is the name the web now matches.',
        {
          title: 'The ranking the web reuses',
          explain:
            'Attention rank first, then the section, then the place in the section. Nothing looks at the file or the line, so two critical spots in one phase keep the order the agent wrote them in.',
        }
      ),
    ],
    judgementCalls: [
      {
        title: 'Rewrite the spot tests',
        call: TESTS_CALL,
        reason:
          'The old tests asserted each renamed function line by line. The new ones cover the same behaviour through the public functions and the recorded fixture.',
        ...placeIn(
          SAMPLE_PATHS.spotsTest,
          review.spotsTest.after,
          'import { formatSpotKey',
          'LARGE_REVIEW_REPORT,'
        ),
        alternatives: [
          {
            option: `Rename the ${countLines(review.targetsTest)}-line targets.test.ts in place`,
            rejected:
              'Every assertion named a function being renamed, so the diff would have been the whole file with no behaviour to read.',
          },
          {
            option: 'Keep both files until the callers moved',
            rejected:
              'targets.test.ts imports a module that no longer exists after phase 1, so it could not run.',
          },
        ],
      },
      {
        title: 'Keep the lockfile bump',
        call: 'Kept the bun.lock change',
        reason: `bun install moved ${lock.name} by one patch release. Reverting it by hand would fail the frozen-lockfile install in CI.`,
        file: SAMPLE_PATHS.lockfile,
        line: lock.line,
        alternatives: [
          {
            option: `Pin ${lock.name} at ${lock.from}`,
            rejected:
              'It is a transitive dependency. Pinning it would add a direct dependency to undo a patch release.',
          },
          {
            option: 'Split it into a commit of its own',
            rejected:
              'bun install wrote it during the move, and a commit with only bun.lock in it says less than this line.',
          },
        ],
      },
      {
        title: 'A module for spot keys',
        call: 'Gave spot keys a module of their own',
        reason:
          'The key was a template literal in targets.ts and in review.tsx. One module with both the writer and the reader keeps the format in one place for links.',
        ...placeIn(SAMPLE_PATHS.spotKeys, review.spotKeys.after, 'export function formatSpotKey', 'return `'),
        alternatives: [
          {
            option: 'Keep formatSpotKey inside spots.ts',
            rejected: 'parseSpotKey would then pull the whole review module into anything that reads a link.',
          },
          {
            option: 'Move the key format into core',
            rejected: 'Core never sees these keys. They only exist to select rows in the web.',
          },
        ],
      },
      {
        title: 'Parse only section and spot keys',
        call: PARSE_CALL,
        reason:
          'Spot links only ever carried a section and a spot. Finding and decision keys select rows inside the page, and a decision key holds a file path, so there was no format to commit to.',
        ...placeIn(SAMPLE_PATHS.spotKeys, review.spotKeys.after, 'const match =', 'if (!match) return null'),
        alternatives: [
          {
            option: 'Parse finding:N and decision:file:line too',
            rejected:
              'A decision key holds a path that can contain a colon, so it needs an escaping rule a rename should not invent.',
          },
          {
            option: 'Return the raw string for any other key',
            rejected:
              'Every caller would have to tell a spot key from anything else again, which is what the parser is for.',
          },
        ],
      },
      {
        title: 'Leave CodeMarker where it is',
        call: 'Left CodeMarker in spots.ts',
        reason:
          'The code view and the changes list draw markers that listFindingMarkers builds in this module. Moving the type alone would split it from the only function that makes it.',
        ...placeIn(SAMPLE_PATHS.spots, review.spots.after, 'export interface CodeMarker', 'text: string'),
        alternatives: [
          {
            option: 'Move CodeMarker next to the code view',
            rejected:
              'The type would sit away from listFindingMarkers, its only producer, and the move is not part of a rename.',
          },
        ],
      },
    ],
  };
}

function listCallersPhase(review: ReviewNotes): SamplePhase {
  return {
    summary:
      'The review, the changes list and the code view import from spots.ts. The recorded fixture exports LARGE_REVIEW_SPOT_COUNT.',
    spots: [
      spotIn(
        SAMPLE_PATHS.review,
        review.review.after,
        'createDecisionSpot,',
        'listReviewSpots,',
        'high',
        'Every renamed function comes in through this one import; the component bodies only changed names.',
        {
          title: 'The review takes every renamed name from one import',
          explain:
            'The component bodies changed only where they call these names. Locals such as `target`, `targets` and `decisionTarget` kept theirs, so every changed line in review.tsx is a name and nothing else.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.review,
        review.review.after,
        '{section.spots.map((spot, spotIndex) => {',
        'const target = toReviewSpot(spot, section.title',
        'high',
        'The walkthrough still builds its key by hand. It matches formatSpotKey today; if the format changes, selection breaks in this order only.',
        {
          title: 'The walkthrough keys its rows by hand',
          explain:
            'In walkthrough order the review renders each section itself instead of calling `listReviewSpots`, so it calls `toReviewSpot` with a template literal. The string equals `formatSpotKey(sectionIndex, spotIndex)`, which is why switching orders keeps the selection.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.review,
        review.review.after,
        'const targets = React.useMemo(',
        '[report, order, findings]',
        'high',
        'Next and previous step through this list: report spots in the chosen order, then findings. Decision spots are never in it.',
        {
          title: 'One list for stepping',
          explain:
            '`ReviewPane` joins `listReviewSpots(report, order)` and the finding rows, and `stepSpot` wraps around the result. The selection is looked up by key in this list, so a key that is not in it falls back to the first spot.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.review,
        review.review.after,
        '<JudgementCalls',
        'createDecisionSpot(file, line)',
        'normal',
        'A judgement call’s place opens a decision spot that stays outside the stepping list until the next selection.'
      ),
      spotIn(
        SAMPLE_PATHS.codeView,
        review.codeView.after,
        '.filter((marker) => marker.line === anchor)',
        '<MarkerNote key=',
        'normal',
        'Unchanged, but it is where a finding shows: under the line the finding ends on, which listFindingMarkers sets.',
        {
          title: 'Where a finding marker lands',
          explain:
            'The code view only knows the `CodeMarker` type from the review module. It draws a note under the row whose anchor equals `marker.line`, and `listFindingMarkers` sets that to the finding’s last line.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.changes,
        review.changes.after,
        'markers={listFindingMarkers(task, selected.path)}',
        'markers={listFindingMarkers(task, selected.path)}',
        'normal',
        'The changes list only reads finding markers, through the same function as the review, so both views mark the same lines.'
      ),
      spotIn(
        SAMPLE_PATHS.fixture,
        review.fixture.after,
        'export const LARGE_REVIEW_SPOT_COUNT',
        'export const LARGE_REVIEW_REPORT',
        'normal',
        `The fixture keeps its ${FIXTURE_SPOT_TOTAL} spots; only the export name and two why texts changed in ${countLines(review.fixture.after).toLocaleString('en-GB')} lines.`,
        {
          title: 'The recorded fixture',
          explain: `A recorded ${FIXTURE_SECTIONS}-section review kept as test data, so the review tests run against every attention and range the agents produce instead of a hand-made three-spot report.`,
        }
      ),
      spotIn(
        SAMPLE_PATHS.spotsTest,
        review.spotsTest.after,
        "it('ignores any other key'",
        'toBeNull()',
        'critical',
        'This test pins the null for finding:2, so the regression the agent review found reads as intended behaviour.',
        {
          title: 'The test that pins the null',
          explain:
            'Written in phase 1 to show `parseSpotKey` rejects anything that is not a spot key. It makes old finding links failing look deliberate; however the blocking finding is settled, this test changes with it.',
        }
      ),
    ],
    judgementCalls: [
      {
        title: 'Rename callers only',
        call: 'Changed only names in the callers',
        reason:
          'The walkthrough in review.tsx still builds its key with a template literal. It gives the same string as formatSpotKey, and changing it is not a rename, so I listed it as a risk instead.',
        ...placeIn(
          SAMPLE_PATHS.review,
          review.review.after,
          'const target = toReviewSpot(spot, section.title'
        ),
        alternatives: [
          {
            option: 'Call formatSpotKey in review.tsx too',
            rejected:
              'Correct, but it puts a behaviour change into a commit the reviewer reads as names only.',
          },
        ],
      },
      {
        title: 'Keep local names in review.tsx',
        call: 'Kept the local target names in review.tsx',
        reason:
          'Locals such as targets, decisionTarget and setDecisionTarget are not exported. Renaming them would triple the diff and hide the import changes that matter.',
        ...placeIn(
          SAMPLE_PATHS.review,
          review.review.after,
          'const [decisionTarget',
          'const index = selected'
        ),
        alternatives: [
          {
            option: 'Rename every local as well',
            rejected: 'Dozens more changed lines in one component, none of which a caller can see.',
          },
        ],
      },
      {
        title: 'Rename the fixture without an alias',
        call: 'Renamed the fixture export without an alias',
        reason: 'Only spots.test.ts imports LARGE_REVIEW_SPOT_COUNT, and it moved in the same phase.',
        ...placeIn(SAMPLE_PATHS.fixture, review.fixture.after, 'export const LARGE_REVIEW_SPOT_COUNT'),
        alternatives: [
          {
            option: 'Export both names for a while',
            rejected: 'knip fails on the unused old name, and nothing outside the test reads it.',
          },
        ],
      },
    ],
  };
}

function listDocsPhase(review: ReviewNotes): SamplePhase {
  return {
    summary: 'The design doc has a short section on review spots and a new screenshot of the walkthrough.',
    spots: [
      spotIn(
        SAMPLE_PATHS.design,
        review.design.after,
        'A spot is a line range a review points at',
        'a spot; schedules and MCP servers keep',
        'high',
        'Says where target still means something: schedules and MCP servers. The next rename pass reads this first.',
        {
          title: 'Where target still belongs',
          explain:
            'A schedule target is what a schedule runs against, and an MCP server target is where a tool call goes. Neither is a place in a review, so the section names both to keep the word from being renamed there.',
        }
      ),
      spotIn(
        SAMPLE_PATHS.design,
        review.design.after,
        '![The review walkthrough',
        '![The review walkthrough',
        'normal',
        'The screenshot is captured again from this branch. The PNG diff cannot show what moved, so check it by eye.'
      ),
    ],
    judgementCalls: [
      {
        title: 'Leave target in settings',
        call: 'Left target in settings and schedules',
        reason:
          'Schedule targets and MCP server targets name what a schedule or a server acts on, not a place in a review.',
        ...placeIn(
          SAMPLE_PATHS.design,
          review.design.after,
          'A spot is a line range a review points at',
          'a spot; schedules and MCP servers keep'
        ),
        alternatives: [
          {
            option: 'Rename every target in the web app',
            rejected:
              'Schedule and MCP targets name what a schedule or a server acts on; calling them spots would be wrong.',
          },
        ],
      },
      {
        title: 'Capture a new screenshot',
        call: 'Captured a new screenshot instead of keeping the old one',
        reason:
          'The old image showed the walkthrough before the rename. A fresh capture of this task shows the current labels with the first spot spotlit.',
        file: SAMPLE_PATHS.screenshot,
        line: null,
        alternatives: [
          {
            option: 'Keep the old screenshot',
            rejected: 'It would show the wording the new section says is gone.',
          },
        ],
      },
    ],
  };
}

export function resolveReviewReport(sample: CodeSample, checks: ReportCheck[]) {
  const { review } = sample;
  const walkthrough = describeReviewWalkthrough(review);
  const phases = withWalkthrough(
    [listRenamePhase(review), listCallersPhase(review), listDocsPhase(review)],
    walkthrough
  );
  return { phases, report: assembleReport(REVIEW_PLAN, phases, checks, walkthrough) };
}

export function listReviewDisagreements(sample: CodeSample): ReviewDisagreement[] {
  return [
    {
      call: PARSE_CALL,
      reason:
        'Links to agent findings worked before this change and now open nothing. finding:N is already the key the page builds, so parse it and leave only decision keys out.',
    },
    {
      call: TESTS_CALL,
      reason: `The old file had ${countTests(sample.review.targetsTest)} tests, including listFindingMarkers, listFindingTargets and stepping from a decision spot. The new one covers none of those, so the rewrite lost behaviour, not just names.`,
    },
  ];
}

export const REVIEW_SUMMARY =
  'I read the rename across lib/review, the code view and the tests, and opened old spot links against the new parser. The rename is clean, but links to agent findings and judgement calls stop working, and I disagree with two of the judgement calls: the narrow parser and the rewritten tests, which dropped the finding and decision coverage.';

export const MERGED_REVIEW_SUMMARY =
  'I read the new queue order and its two tests. Urgent work sits on top inside each gate and the input is left untouched; nothing to report.';

export function listReviewFindings(sample: CodeSample): ReviewFinding[] {
  const { review } = sample;
  const listFinding = resolveLine(review.spots.after, 'export function listFindingSpots');
  return [
    {
      severity: 'blocking',
      file: SAMPLE_PATHS.spotKeys,
      line: resolveLine(review.spotKeys.after, 'const match ='),
      title: 'Old links to findings open nothing',
      message:
        'parseSpotKey returns null for finding and decision keys, so a link to an agent finding or a judgement call opens nothing. The new test pins the null, so the regression looks intended.',
      fix: 'Parse `finding:N` and `decision:N` as keys of their own, or leave those keys out of the link, and change the test that pins the null.',
    },
    {
      severity: 'suggestion',
      file: SAMPLE_PATHS.spots,
      line: listFinding,
      end: resolveLine(review.spots.after, "section: 'Agent review'", listFinding),
      message:
        'listFindingSpots and listFindingMarkers both check isLocated and map a severity to a tone. One helper would keep the two from drifting.',
      title: 'Two copies of the severity mapping',
      fix: 'Extract `resolveFindingTone(finding)` and call it from both functions.',
    },
    {
      severity: 'suggestion',
      file: SAMPLE_PATHS.codeView,
      line: resolveLine(review.codeView.after, "from '@/lib/review/spots.ts'"),
      message:
        'The code view only needs CodeMarker. Moving that type next to the code view would keep the review module out of its chunk.',
      title: 'The code view pulls in the review module',
      fix: 'Move `CodeMarker` into the code view folder and import it from there.',
    },
    {
      severity: 'suggestion',
      file: SAMPLE_PATHS.webGuide,
      line: resolveLine(review.webGuide.before, 'Review targets and markers'),
      title: 'The web guide still says targets',
      message:
        'apps/web/CLAUDE.md still describes lib/review as review targets, so the next agent reads the old name.',
      fix: 'Change the line to “Review spots and markers”.',
    },
    {
      severity: 'suggestion',
      file: null,
      line: null,
      message:
        'Settings, schedules and MCP code still say target. They mean something else and should keep it, but add them to the plan’s out of scope so the next pass does not rename them.',
      title: 'Other uses of target are not marked out of scope',
      fix: 'Add “target in settings, schedules and MCP code” to the plan’s out of scope.',
    },
  ];
}

const FAILED_CHECKS: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
  { name: 'bun run test', outcome: 'pass', detail: null },
  {
    name: 'bunx knip',
    outcome: 'fail',
    detail: `Unused exported types (1)\nSpotKey  interface  ${SAMPLE_PATHS.spotKeys}:1:18`,
  },
];

const PASSED_CHECKS: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
  { name: 'bun run test', outcome: 'pass', detail: '5 new tests' },
  { name: 'bunx knip', outcome: 'pass', detail: null },
];

function scriptReview(sample: CodeSample, push: Push) {
  const task = SAMPLE_REVIEW;
  const at = (minutes: number) => NOW - REVIEW_AGE_HOURS * HOUR + minutes * MINUTE;
  const { phases, report } = resolveReviewReport(sample, PASSED_CHECKS);
  const [plannerFrom, plannerTo] = REVIEW_MARKS.planner;
  stage(push, task, at(0.5), 'planning', 'planning the phases');
  pushRun(push, {
    taskId: task,
    index: 0,
    role: 'agent',
    purpose: 'plan',
    from: at(plannerFrom),
    to: at(plannerTo),
    summary: 'Proposed a three-phase rename.',
  });
  push(at(plannerTo - 0.2), {
    type: 'plan.proposed',
    taskId: task,
    body: REVIEW_PLAN.goal,
    document: REVIEW_PLAN,
  });
  stage(push, task, at(plannerTo + 0.2), 'building', 'building phase 1 of 3');
  for (const [index, marks] of REVIEW_MARKS.builders.entries()) {
    const phase = phases[index];
    if (!phase) continue;
    pushRun(push, {
      taskId: task,
      index: index + 1,
      role: 'agent',
      purpose: 'build',
      from: at(marks[0]),
      to: at(marks[1]),
      summary: `${REVIEW_PLAN.phases[index]?.title}: done.`,
      phaseIndex: index,
    });
    pushPhase(push, task, index, [at(marks[0]), at(marks[1])], {
      ...phase,
      tree: sample.review.trees[index] ?? '',
    });
  }
  stage(push, task, at(40.2), 'checking', 'running the checks');
  push(at(REVIEW_MARKS.failedChecks), { type: 'checks.recorded', taskId: task, results: FAILED_CHECKS });
  push(at(REVIEW_MARKS.failedChecks + 0.1), {
    type: 'fix.started',
    taskId: task,
    round: 1,
    reason: 'checks',
  });
  stage(push, task, at(REVIEW_MARKS.failedChecks + 0.2), 'fixing', 'fixing failing checks');
  pushRun(push, {
    taskId: task,
    index: 4,
    role: 'agent',
    purpose: 'fix',
    from: at(REVIEW_MARKS.fix[0]),
    to: at(REVIEW_MARKS.fix[1]),
    summary: 'SpotKey is no longer exported; knip passes.',
  });
  push(at(REVIEW_MARKS.fix[1] - 0.2), {
    type: 'work.committed',
    taskId: task,
    treeHash: sample.review.trees[3] ?? '',
  });
  stage(push, task, at(REVIEW_MARKS.fix[1] + 0.2), 'checking', 'running the checks');
  push(at(REVIEW_MARKS.passedChecks), { type: 'checks.recorded', taskId: task, results: PASSED_CHECKS });
  stage(push, task, at(REVIEW_MARKS.passedChecks + 0.2), 'reviewing', 'agent review');
  const reviewer = runId(task, 5);
  pushRun(push, {
    taskId: task,
    index: 5,
    role: 'reviewer',
    from: at(REVIEW_MARKS.reviewer[0]),
    to: at(REVIEW_MARKS.reviewer[1]),
    summary: 'One blocking finding on old spot links, four suggestions and two disputed judgement calls.',
  });
  push(at(REVIEW_MARKS.reviewer[1] - 0.2), {
    type: 'review.reported',
    taskId: task,
    summary: REVIEW_SUMMARY,
    findings: listReviewFindings(sample),
    disagreements: listReviewDisagreements(sample),
    runId: reviewer,
  });
  push(at(REVIEW_MARKS.reviewer[1] + 0.2), {
    type: 'work.submitted',
    taskId: task,
    summary: report.headline,
    report,
  });
  stage(push, task, at(REVIEW_MARKS.reviewer[1] + 0.3), 'awaiting_review', 'changes ready for your review');
  openGate(push, at(REVIEW_MARKS.reviewer[1] + 0.3), {
    id: `${task}-gate`,
    taskId: task,
    type: 'review',
    title: 'Rename review targets to review spots',
    body: serializeReportMarkdown(report),
    runId: null,
  });
}

export const MERGED_PLAN: PlanDocument = {
  goal: 'Tasks at the same gate sit in priority order, urgent first, so the queue reads top to bottom as what to do next.',
  phases: [
    {
      title: 'Stack entries by priority',
      detail: 'A stackByPriority helper in the queue, oldest first inside a priority.',
    },
    {
      title: 'Cover the order with tests',
      detail: 'One test for the order and one that the input is left alone.',
    },
  ],
  behaviour: ['An urgent task at the review gate sits above a normal one that arrived earlier.'],
  approach: 'A pure helper beside resolveQueue, exported from the queue barrel so the web can use it next.',
  files: [
    { path: SAMPLE_PATHS.queueStack, change: 'New: stackByPriority.' },
    { path: SAMPLE_PATHS.queueIndex, change: 'Exports it.' },
    { path: SAMPLE_PATHS.queueTest, change: 'New tests.' },
  ],
  outOfScope: ['Changing how gates are ranked against each other.'],
  verification: ['bun test packages/core/test/queue'],
  questions: [],
};

const MERGED_CHECKS: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
  { name: 'bun run test', outcome: 'pass', detail: '2 new tests' },
  { name: 'bunx knip', outcome: 'pass', detail: null },
];

function describeMergedWalkthrough(merged: MergedNotes): ReportWalkthrough {
  return {
    approach:
      'A pure helper beside the queue instead of a change to how gates are ranked. `stackByPriority` takes any entry that carries a task, sorts a copy by priority and then by age, and is exported from the queue barrel so the web can adopt it one list at a time.',
    flow: [
      '```text',
      'stackByPriority(entries)',
      '        │',
      '        ▼',
      '[...entries]                  a copy, the caller’s array stays put',
      '        │',
      '        ▼',
      'PRIORITY_RANK                 urgent 0, high 1, normal 2, low 3',
      '        │ equal rank',
      '        ▼',
      'task.createdAt                oldest first',
      '        │',
      '        ▼',
      'new array ──▶ queue barrel ──▶ the web adopts it, one list at a time',
      '```',
      '',
      'The caller’s array is copied first, so state that holds it never changes under it. `PRIORITY_RANK` puts urgent at 0 and low at 3; equal ranks fall through to the creation time, oldest first.',
    ].join('\n'),
    risks: [
      riskIn(
        'A new priority needs a rank',
        'A priority missing from `PRIORITY_RANK` would compare as NaN and leave the order to the engine. The type rules it out today; a new priority has to be added to the table.',
        SAMPLE_PATHS.queueStack,
        merged.stack,
        'PRIORITY_RANK[a.task.priority]'
      ),
      riskIn(
        'Nothing uses the helper yet',
        'Nothing calls `stackByPriority` yet, so the queue on screen does not change until the web adopts it.',
        SAMPLE_PATHS.queueIndex,
        merged.index.after,
        'export { stackByPriority }'
      ),
    ],
    testing: {
      automated: [
        '`bun test packages/core/test/queue`: the order across urgent, high and low with a tie on high, and that the input array is left untouched.',
        'Nothing to try on screen yet: no screen uses the helper.',
      ],
      manual: [
        {
          file: SAMPLE_PATHS.queueStack,
          start: stackLine,
          end: stackLine + 5,
          attention: 'high' as const,
          why: 'Ties keep the oldest task first, so two urgent reviews never swap places on a refresh.',
        },
      ],
    },
  };
}

export function resolveMergedReport(sample: CodeSample) {
  const { merged } = sample;
  const walkthrough = describeMergedWalkthrough(merged);
  const phases = withWalkthrough(
    [
      {
        summary: 'stackByPriority sorts by priority, then by age, and never mutates its input.',
        spots: [
          spotIn(
            SAMPLE_PATHS.queueStack,
            merged.stack,
            'return [...entries].sort(',
            'PRIORITY_RANK[a.task.priority]',
            'high',
            'Ties keep the oldest task first, so two urgent reviews never swap places on a refresh.',
            {
              title: 'Priority first, age second',
              explain:
                '`PRIORITY_RANK` maps urgent to 0 and low to 3, so subtracting ranks puts urgent first. Equal ranks subtract to 0 and `||` falls through to `createdAt`, oldest first. The spread copies the array, so `sort` never touches the caller’s list.',
            }
          ),
          spotIn(
            SAMPLE_PATHS.queueIndex,
            merged.index.after,
            'export { stackByPriority }',
            'export { stackByPriority }',
            'normal',
            'Exported from the queue barrel so the web can stack its lists next without reaching into the file.'
          ),
        ],
        judgementCalls: [
          {
            title: 'Break ties by creation time',
            call: 'Broke ties by creation time',
            reason:
              'Without a second key two urgent tasks could trade places whenever the list is rebuilt. createdAt never changes, so the order holds across refreshes.',
            ...placeIn(SAMPLE_PATHS.queueStack, merged.stack, 'PRIORITY_RANK[a.task.priority]'),
            alternatives: [
              {
                option: 'Break ties by task id',
                rejected: 'Ids are random, so the order would be stable but mean nothing to the reader.',
              },
              {
                option: 'Rely on a stable sort and the input order',
                rejected:
                  'The input order is whatever the caller happened to build, so it would differ between views.',
              },
            ],
          },
          {
            title: 'A helper beside resolveQueue',
            call: 'Added a helper instead of changing resolveQueue',
            reason:
              'resolveQueue decides which gate a task waits at. Keeping the order separate lets the web adopt it one list at a time.',
            ...placeIn(SAMPLE_PATHS.queueIndex, merged.index.after, 'export { stackByPriority }'),
            alternatives: [
              {
                option: 'Sort inside resolveQueue',
                rejected:
                  'Every caller would get the new order in the same change, which the plan kept for later.',
              },
            ],
          },
        ],
      },
      {
        summary: 'Two tests: the order across priorities and that the input array is left alone.',
        spots: [
          spotIn(
            SAMPLE_PATHS.queueTest,
            merged.test,
            "test('puts urgent work",
            "toEqual(['urgent'",
            'normal',
            'The order the queue shows.',
            {
              title: 'Both keys in one test',
              explain:
                'Two high tasks of different ages sit between an urgent and a low one. The expected order only holds if priority wins first and age breaks the tie.',
            }
          ),
          spotIn(
            SAMPLE_PATHS.queueTest,
            merged.test,
            "test('leaves the input alone'",
            "toEqual(['b', 'a'])",
            'normal',
            'Guards the copy: sorting in place would reorder the caller’s array behind its back.'
          ),
        ],
        judgementCalls: [
          {
            title: 'Cast the test tasks',
            call: 'Built test tasks with a cast',
            reason:
              'The order reads three fields. A complete Task needs every field the domain has, which would bury what each test checks.',
            ...placeIn(
              SAMPLE_PATHS.queueTest,
              merged.test,
              'return { task: { id, priority, createdAt } as Task }'
            ),
            alternatives: [
              {
                option: 'Build complete tasks with a factory',
                rejected: 'More setup than assertion, and none of the extra fields affect the order.',
              },
            ],
          },
        ],
      },
    ],
    walkthrough
  );
  return { phases, report: assembleReport(MERGED_PLAN, phases, MERGED_CHECKS, walkthrough) };
}

function scriptMerged(sample: CodeSample, push: Push) {
  const task = SAMPLE_MERGED;
  const at = (minutes: number) => NOW - MERGED_AGE_HOURS * HOUR + minutes * MINUTE;
  const { merged } = sample;
  const { phases, report } = resolveMergedReport(sample);
  const checks = MERGED_CHECKS;
  stage(push, task, at(0.5), 'planning', 'planning the phases');
  pushRun(push, {
    taskId: task,
    index: 0,
    role: 'agent',
    purpose: 'plan',
    from: at(MERGED_MARKS.planner[0]),
    to: at(MERGED_MARKS.planner[1]),
    summary: 'Proposed a two-phase plan.',
  });
  push(at(MERGED_MARKS.planner[1] - 0.2), {
    type: 'plan.proposed',
    taskId: task,
    body: MERGED_PLAN.goal,
    document: MERGED_PLAN,
  });
  stage(push, task, at(MERGED_MARKS.planner[1] + 0.2), 'building', 'building phase 1 of 2');
  for (const [index, marks] of MERGED_MARKS.builders.entries()) {
    const phase = phases[index];
    if (!phase) continue;
    pushRun(push, {
      taskId: task,
      index: index + 1,
      role: 'agent',
      purpose: 'build',
      from: at(marks[0]),
      to: at(marks[1]),
      summary: `${MERGED_PLAN.phases[index]?.title}: done.`,
      phaseIndex: index,
    });
    pushPhase(push, task, index, [at(marks[0]), at(marks[1])], { ...phase, tree: merged.trees[index] ?? '' });
  }
  stage(push, task, at(22.2), 'checking', 'running the checks');
  push(at(MERGED_MARKS.checks), { type: 'checks.recorded', taskId: task, results: checks });
  stage(push, task, at(MERGED_MARKS.checks + 0.2), 'reviewing', 'agent review');
  pushRun(push, {
    taskId: task,
    index: 3,
    role: 'reviewer',
    from: at(MERGED_MARKS.reviewer[0]),
    to: at(MERGED_MARKS.reviewer[1]),
    summary: 'No findings.',
  });
  push(at(MERGED_MARKS.reviewer[1] - 0.2), {
    type: 'review.reported',
    taskId: task,
    summary: MERGED_REVIEW_SUMMARY,
    findings: [],
    runId: runId(task, 3),
  });
  push(at(MERGED_MARKS.reviewer[1] + 0.2), {
    type: 'work.submitted',
    taskId: task,
    summary: report.headline,
    report,
  });
  stage(push, task, at(MERGED_MARKS.reviewer[1] + 0.3), 'awaiting_review', 'changes ready for your review');
  const reviewGate = `${task}-review`;
  openGate(push, at(MERGED_MARKS.reviewer[1] + 0.3), {
    id: reviewGate,
    taskId: task,
    type: 'review',
    title: 'Stack the queue by priority',
    body: serializeReportMarkdown(report),
    runId: null,
  });
  push(at(MERGED_MARKS.approved), {
    type: 'gate.answered',
    gateId: reviewGate,
    decision: 'approve',
    response: null,
  });
  stage(push, task, at(MERGED_MARKS.approved + 0.1), 'shipping', 'opening the pull request');
  const pullRequest = {
    number: PULL_REQUEST_NUMBER,
    url: `https://github.com/shinsa-dev/shinsa-sample/pull/${PULL_REQUEST_NUMBER}`,
    state: 'open' as const,
    checks: 'passing' as const,
    unresolvedComments: 0,
    mergeable: true,
    headSha: merged.head,
    updatedAt: at(MERGED_MARKS.pullRequest),
  };
  push(at(MERGED_MARKS.pullRequest - 0.5), { type: 'pull_request.pushed', taskId: task, sha: merged.head });
  push(at(MERGED_MARKS.pullRequest), { type: 'pull_request.opened', taskId: task, pullRequest });
  stage(push, task, at(MERGED_MARKS.pullRequest + 2), 'awaiting_merge', 'clean and ready to merge');
  const mergeGate = `${task}-merge`;
  openGate(push, at(MERGED_MARKS.pullRequest + 2), {
    id: mergeGate,
    taskId: task,
    type: 'merge',
    title: `Merge #${PULL_REQUEST_NUMBER}`,
    body: 'Checks are green and nothing is unresolved.',
    runId: null,
  });
  push(at(MERGED_MARKS.merge - 0.5), {
    type: 'gate.answered',
    gateId: mergeGate,
    decision: 'approve',
    response: null,
  });
  push(at(MERGED_MARKS.merge), {
    type: 'pull_request.updated',
    taskId: task,
    pullRequest: {
      ...pullRequest,
      state: 'merged',
      mergeCommit: merged.mergeCommit,
      updatedAt: at(MERGED_MARKS.merge),
    },
  });
  stage(push, task, at(MERGED_MARKS.merge + 0.1), 'merged', 'merged');
  push(at(MERGED_MARKS.merge + 0.5), { type: 'worktree.removed', taskId: task });
}

export const LIVE_PLAN: PlanDocument = {
  goal: 'The code view colours tokens from Shinsa’s own palette in both themes instead of GitHub’s, so code reads like the rest of the app in dark mode.',
  phases: [
    {
      title: 'Add the code tokens',
      detail: 'Keyword, string, number, comment, function and type colours for light and dark.',
    },
    {
      title: 'Theme the highlighter',
      detail: 'Map highlighter scopes to the tokens in a small theme module.',
    },
    { title: 'Check both themes', detail: 'Screenshots of a TypeScript file in light and dark.' },
  ],
  behaviour: ['Switching to dark mode recolours the code without a reload.'],
  approach:
    'CSS variables in the kit, read through one scope map, so the editor and the chat can share them later.',
  files: [
    { path: SAMPLE_PATHS.tokens, change: 'The --code-* tokens.' },
    { path: SAMPLE_PATHS.theme, change: 'New: scope to token map.' },
    { path: SAMPLE_PATHS.highlight, change: 'Uses the theme.' },
  ],
  outOfScope: ['The chat’s code fences.'],
  verification: ['Screenshots in both themes.'],
  questions: [],
  evidence: ['screenshot'],
};

export function resolveLivePhase(sample: CodeSample): SamplePhase {
  const tokens = sample.live.tokens.after;
  const light = resolveLine(tokens, '--code-keyword');
  const dark = resolveLine(tokens, '.dark {', light);
  return {
    summary: 'Six code colour tokens for light and dark, at the end of the kit’s globals.',
    spots: [
      {
        file: SAMPLE_PATHS.tokens,
        start: light - 1,
        end: resolveLine(tokens, '--code-type', light - 1),
        attention: 'normal',
        why: 'Light values stay dark enough to read on the page surface, one hue per kind of token.',
        title: 'The light palette',
        explain:
          'Six variables, one per kind of token the highlighter tells apart. They use `oklch` like the rest of the kit, so lightness is the same number across hues and the six read as one weight.',
      },
      {
        file: SAMPLE_PATHS.tokens,
        start: dark,
        end: resolveLine(tokens, '--code-type', dark - 1),
        attention: 'normal',
        why: 'Dark values are lighter and less saturated so they hold contrast on the dark surface.',
        title: 'Dark overrides',
        explain:
          'The `.dark` block redefines the same six variables, so anything that reads `var(--code-keyword)` switches with the theme and needs no reload.',
      },
    ],
    judgementCalls: [
      {
        title: 'Code colours in the kit globals',
        call: 'Put the code colours in the kit’s globals',
        reason:
          'The chat’s code fences will need the same colours later, and the kit is what both the code view and the chat read.',
        file: SAMPLE_PATHS.tokens,
        line: light,
        alternatives: [
          {
            option: 'Use a Shiki theme for each mode',
            rejected:
              'Its colours come from GitHub, which is what the request asked to replace, and switching themes would mean highlighting again.',
          },
        ],
      },
    ],
  };
}

function scriptLive(sample: CodeSample, push: Push) {
  const task = SAMPLE_LIVE;
  const at = (minutes: number) => NOW - LIVE_AGE_HOURS * HOUR + minutes * MINUTE;
  stage(push, task, at(0.3), 'planning', 'planning the phases');
  pushRun(push, {
    taskId: task,
    index: 0,
    role: 'agent',
    purpose: 'plan',
    from: at(LIVE_MARKS.planner[0]),
    to: at(LIVE_MARKS.planner[1]),
    summary: 'Proposed a three-phase plan.',
  });
  push(at(LIVE_MARKS.planner[1] - 0.2), {
    type: 'plan.proposed',
    taskId: task,
    body: LIVE_PLAN.goal,
    document: LIVE_PLAN,
  });
  stage(push, task, at(LIVE_MARKS.planner[1] + 0.2), 'building', 'building phase 1 of 3');
  pushRun(push, {
    taskId: task,
    index: 1,
    role: 'agent',
    purpose: 'build',
    from: at(LIVE_MARKS.builder[0]),
    to: at(LIVE_MARKS.builder[1]),
    summary: 'Add the code tokens: done.',
    phaseIndex: 0,
  });
  const start = resolveLine(
    sample.live.tokens.after,
    '@layer base {',
    resolveLine(sample.live.tokens.after, '--code-keyword') - 4
  );
  pushPhase(push, task, 0, [at(LIVE_MARKS.builder[0]), at(LIVE_MARKS.builder[1])], {
    ...resolveLivePhase(sample),
    tree: sample.live.trees[0] ?? '',
  });
  push(at(LIVE_MARKS.working), { type: 'phase.updated', taskId: task, index: 1, status: 'active' });
  stage(push, task, at(LIVE_MARKS.working + 0.05), 'building', 'building phase 2 of 3');
  pushRun(push, {
    taskId: task,
    index: 2,
    role: 'agent',
    purpose: 'build',
    from: at(LIVE_MARKS.working),
    to: null,
    summary: '',
    phaseIndex: 1,
  });
}

function describeAnswer(ranking: string) {
  const line = resolveLine(ranking, 'export function listRankedSpots');
  return [
    `Core ranks them in \`listRankedSpots\` ([markdown.ts](shinsa://file/${SAMPLE_PATHS.ranking}#L${line})): critical first, then high, then normal, from the \`ATTENTION_RANK\` table at the top of the same file.`,
    '',
    'Inside one rank the agents’ order wins: the section a spot came from, then its place in that section. Nothing looks at the file or the line, so two critical spots in one phase stay in the order the agent wrote them.',
    '',
    `The web asks for that order when you pick “By attention”: \`listReviewTargets(report, 'attention')\` in [targets.ts](shinsa://file/${SAMPLE_PATHS.targets}) maps each ranked spot to a row and keys it by section and spot.`,
  ].join('\n');
}

export function listCodeTasks(sample: CodeSample): SeedTask[] {
  const { repo } = sample;
  return [
    {
      id: SAMPLE_MERGED,
      request: 'Stack the queue by priority: urgent work should sit on top inside each gate.',
      title: 'Stack the queue by priority',
      repo,
      size: 'small',
      shape: 'change',
      stage: 'merged',
      reason: 'merged',
      branch: 'feat/queue-priority-stack',
      ageHours: MERGED_AGE_HOURS,
      worktreePath: sample.merged.worktree,
      script: (push) => scriptMerged(sample, push),
    },
    {
      id: SAMPLE_REVIEW,
      request:
        'Rename review targets to review spots in the web app. Core and the agents already say spot; the web still says target.',
      title: 'Rename review targets to review spots',
      repo,
      size: 'large',
      shape: 'change',
      priority: 'high',
      stage: 'awaiting_review',
      reason: 'changes ready for your review',
      branch: 'refactor/review-spots',
      ageHours: REVIEW_AGE_HOURS,
      worktreePath: sample.review.worktree,
      script: (push) => scriptReview(sample, push),
    },
    {
      id: SAMPLE_ANSWER,
      request: 'How does the review decide the order of spots when I sort by attention?',
      title: 'How the review orders spots by attention',
      repo,
      size: 'small',
      shape: 'answer',
      stage: 'done',
      reason: 'answered your question',
      branch: 'ask/review-spot-order',
      ageHours: ANSWER_AGE_HOURS,
      runs: [
        {
          role: 'answerer',
          minutes: ANSWER_MARKS.answerer[1] - ANSWER_MARKS.answerer[0],
          summary: 'Answered the question.',
        },
      ],
      extra: [
        {
          type: 'task.delivered',
          taskId: SAMPLE_ANSWER,
          step: 'answer',
          body: describeAnswer(sample.review.ranking),
          runId: runId(SAMPLE_ANSWER, 0),
        },
      ],
    },
    {
      id: SAMPLE_LIVE,
      request: 'Give the code view a proper dark theme from our own tokens instead of the GitHub colours.',
      title: 'Add a dark theme to the code view',
      repo,
      size: 'large',
      shape: 'change',
      stage: 'building',
      reason: 'building phase 2 of 3',
      branch: 'feat/code-view-dark-theme',
      ageHours: LIVE_AGE_HOURS,
      worktreePath: sample.live.worktree,
      script: (push) => scriptLive(sample, push),
    },
  ];
}
