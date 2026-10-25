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
  phase: { summary: string; spots: CodeSpot[]; judgementCalls: JudgementCall[]; tree: string }
) {
  const report: PhaseReport = {
    index,
    runId: runId(taskId, index + 1),
    summary: phase.summary,
    spots: phase.spots,
    judgementCalls: phase.judgementCalls,
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

function spotIn(
  file: string,
  content: string,
  from: string,
  to: string,
  attention: CodeSpot['attention'],
  why: string
) {
  const start = resolveLine(content, from);
  return { file, start, end: resolveLine(content, to, start - 1), attention, why };
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

export function resolveReviewReport(sample: CodeSample, checks: ReportCheck[]) {
  const { review } = sample;
  const lockLine = review.lock.line;
  const phases: { summary: string; spots: CodeSpot[]; judgementCalls: JudgementCall[] }[] = [
    {
      summary:
        'targets.ts is now spots.ts with ReviewSpot and the matching function names. Spot keys live in spot-keys.ts. The old tests are replaced by smaller ones against the recorded fixture.',
      spots: [
        spotIn(
          SAMPLE_PATHS.spotKeys,
          review.spotKeys.after,
          'export function parseSpotKey',
          'return { section',
          'critical',
          'Only section and spot keys parse. A finding or judgement call key from an older link comes back as null.'
        ),
        spotIn(
          SAMPLE_PATHS.spots,
          review.spots.after,
          'export function listReviewSpots',
          'section.spots.map',
          'high',
          'The by-attention order still comes from listRankedSpots in core; only the names and the key format changed.'
        ),
        {
          file: SAMPLE_PATHS.lockfile,
          start: lockLine,
          end: lockLine,
          attention: 'normal',
          why: `bun install re-resolved ${review.lock.name} from ${review.lock.from} to ${review.lock.to}. No dependency was added.`,
        },
        spotIn(
          SAMPLE_PATHS.ranking,
          review.ranking,
          'export function listRankedSpots',
          'a.spotIndex - b.spotIndex',
          'normal',
          'Not changed: core already calls these spots. This is the name the web now matches.'
        ),
      ],
      judgementCalls: [
        {
          call: 'Rewrote the tests instead of renaming them',
          reason:
            'The old tests asserted each renamed function line by line. The new ones cover the same behaviour through the public functions and the recorded fixture.',
          file: SAMPLE_PATHS.spotsTest,
          line: 1,
        },
        {
          call: 'Kept the bun.lock change',
          reason: `bun install moved ${review.lock.name} by one patch release. Reverting it by hand would fail the frozen-lockfile install in CI.`,
          file: SAMPLE_PATHS.lockfile,
          line: lockLine,
        },
      ],
    },
    {
      summary:
        'The review, the changes list and the code view import from spots.ts. The recorded fixture exports LARGE_REVIEW_SPOT_COUNT.',
      spots: [
        spotIn(
          SAMPLE_PATHS.review,
          review.review.after,
          'createDecisionSpot,',
          "from '@/lib/review/spots.ts'",
          'high',
          'Every renamed function comes in through this one import; the component bodies only changed names.'
        ),
        spotIn(
          SAMPLE_PATHS.codeView,
          review.codeView.after,
          "from '@/lib/review/spots.ts'",
          "from '@/lib/review/spots.ts'",
          'high',
          'The code view only needs the CodeMarker type, which moved with the module.'
        ),
        spotIn(
          SAMPLE_PATHS.changes,
          review.changes.after,
          "from '@/lib/review/spots.ts'",
          "from '@/lib/review/spots.ts'",
          'normal',
          'The changes list reads finding markers only.'
        ),
        spotIn(
          SAMPLE_PATHS.fixture,
          review.fixture.after,
          'The first review spot in this file.',
          'The first review spot in this file.',
          'normal',
          `The fixture keeps its ${FIXTURE_SPOT_TOTAL} spots; only the export name and two why texts changed in ${countLines(review.fixture.after).toLocaleString('en-GB')} lines.`
        ),
      ],
      judgementCalls: [],
    },
    {
      summary: 'The design doc has a short section on review spots and a new screenshot of the walkthrough.',
      spots: [
        spotIn(
          SAMPLE_PATHS.design,
          review.design.after,
          '## Review spots',
          '![The review walkthrough',
          'normal',
          'Says why schedules and MCP servers keep the word target.'
        ),
      ],
      judgementCalls: [
        {
          call: 'Left target in settings and schedules',
          reason:
            'Schedule targets and MCP server targets name what a schedule or a server acts on, not a place in a review.',
          file: null,
          line: null,
        },
      ],
    },
  ];
  const report: WorkReport = {
    headline: REVIEW_PLAN.goal,
    sections: phases.map((phase, index) => ({
      title: REVIEW_PLAN.phases[index]?.title ?? `Phase ${index + 1}`,
      summary: phase.summary,
      spots: phase.spots,
    })),
    checks,
    judgementCalls: phases.flatMap((phase) => phase.judgementCalls),
  };
  return { phases, report };
}

export const REVIEW_SUMMARY =
  'I read the rename across lib/review, the code view and the tests, and opened old spot links against the new parser. The rename is clean, but links to agent findings and judgement calls stop working.';

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
    summary: 'One blocking finding on old spot links, four suggestions.',
  });
  push(at(REVIEW_MARKS.reviewer[1] - 0.2), {
    type: 'review.reported',
    taskId: task,
    summary: REVIEW_SUMMARY,
    findings: listReviewFindings(sample),
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

function scriptMerged(sample: CodeSample, push: Push) {
  const task = SAMPLE_MERGED;
  const at = (minutes: number) => NOW - MERGED_AGE_HOURS * HOUR + minutes * MINUTE;
  const { merged } = sample;
  const stackLine = resolveLine(QUEUE_STACK, 'export function stackByPriority');
  const phases = [
    {
      summary: 'stackByPriority sorts by priority, then by age, and never mutates its input.',
      spots: [
        {
          file: SAMPLE_PATHS.queueStack,
          start: stackLine,
          end: stackLine + 5,
          attention: 'high' as const,
          why: 'Ties keep the oldest task first, so two urgent reviews never swap places on a refresh.',
        },
      ],
      judgementCalls: [],
    },
    {
      summary: 'Two tests: the order across priorities and that the input array is left alone.',
      spots: [
        spotIn(
          SAMPLE_PATHS.queueTest,
          QUEUE_TEST,
          "test('puts urgent work",
          "toEqual(['urgent'",
          'normal',
          'The order the queue shows.'
        ),
      ],
      judgementCalls: [],
    },
  ];
  const checks: ReportCheck[] = [
    { name: 'bun lint', outcome: 'pass', detail: null },
    { name: 'bun check-types', outcome: 'pass', detail: null },
    { name: 'bun run test', outcome: 'pass', detail: '2 new tests' },
    { name: 'bunx knip', outcome: 'pass', detail: null },
  ];
  const report: WorkReport = {
    headline: MERGED_PLAN.goal,
    sections: phases.map((phase, index) => ({
      title: MERGED_PLAN.phases[index]?.title ?? '',
      summary: phase.summary,
      spots: phase.spots,
    })),
    checks,
    judgementCalls: [],
  };
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
    summary: 'Six code colour tokens for light and dark, at the end of the kit’s globals.',
    spots: [
      {
        file: SAMPLE_PATHS.tokens,
        start,
        end: start + 18,
        attention: 'normal',
        why: 'Dark values are lighter and less saturated so they hold contrast on the dark surface.',
      },
    ],
    judgementCalls: [],
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
