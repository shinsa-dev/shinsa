import type {
  DiffFile,
  FileContent,
  FileWrite,
  FileWritten,
  RefCommit,
  RepoEntry,
  RepoPaths,
  RepoTree,
  SearchResult,
  TaskDiff,
  TaskRefs,
} from '@shinsa/core';
import {
  DRAFT_STORE_AFTER,
  DRAFT_STORE_BEFORE,
  DRAFT_TEST_AFTER,
  PROGRESS_DOTS_AFTER,
  RESUME_AFTER,
  ROUTE_AFTER,
  ROUTE_BEFORE,
  STEPS_AFTER,
  UNCHANGED_FILES,
} from './onboarding-code.ts';
import { TINT_CHANGES, TINT_UNCHANGED, TONE_PATH } from './tint-code.ts';

interface ChangedFile {
  before: string | null;
  after: string;
  risk: DiffFile['risk'];
  riskReason: string | null;
}

interface Repository {
  base: string;
  head: string;
  branch: string;
  commits: RefCommit[];
  changed: Record<string, ChangedFile>;
  unchanged: Record<string, string>;
  edits: Map<string, string>;
}

const NORTHWIND: Repository = {
  base: '3f9a1c27e8b04d5f6a7b8c9d0e1f2a3b4c5d6e7f',
  head: '8c41d0f2a9e7b3c5d1f4a6b8c0e2d4f6a8b0c2e4',
  branch: 'feat/onboarding-steps',
  commits: [
    {
      sha: '8c41d0f2a9e7b3c5d1f4a6b8c0e2d4f6a8b0c2e4',
      subject: 'feat(onboarding): show progress and resume on the next step',
      at: Date.now() - 4 * 60_000,
    },
    {
      sha: '5b2e9d7c1a3f4e6b8d0c2a4e6f8b0d2c4e6a8f0b',
      subject: 'feat(onboarding): save each step as a draft',
      at: Date.now() - 9 * 60_000,
    },
    {
      sha: '1d7f3b5a9c2e4d6f8a0b2c4d6e8f0a2b4c6d8e0f',
      subject: 'feat(onboarding): split the form into three steps',
      at: Date.now() - 14 * 60_000,
    },
  ],
  changed: {
    'src/onboarding/draft-store.ts': {
      before: DRAFT_STORE_BEFORE,
      after: DRAFT_STORE_AFTER,
      risk: 'high',
      riskReason: 'Writes to the database',
    },
    'src/onboarding/resume.ts': { before: null, after: RESUME_AFTER, risk: 'normal', riskReason: null },
    'src/onboarding/steps.ts': { before: null, after: STEPS_AFTER, risk: 'normal', riskReason: null },
    'src/routes/onboarding.tsx': {
      before: ROUTE_BEFORE,
      after: ROUTE_AFTER,
      risk: 'normal',
      riskReason: null,
    },
    'src/onboarding/progress-dots.tsx': {
      before: null,
      after: PROGRESS_DOTS_AFTER,
      risk: 'low',
      riskReason: null,
    },
    'test/onboarding/draft-store.test.ts': {
      before: null,
      after: DRAFT_TEST_AFTER,
      risk: 'low',
      riskReason: 'Tests',
    },
  },
  unchanged: UNCHANGED_FILES,
  edits: new Map(),
};

const SHINSA: Repository = {
  base: '4e0c7a91d2b85f3e6a1c9d7b0f2e4a6c8b1d3f5e',
  head: 'b7d24e9f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b',
  branch: 'feat/tinted-roadmap-icons',
  commits: [
    {
      sha: 'b7d24e9f1a3c5e7b9d0f2a4c6e8b1d3f5a7c9e0b',
      subject: 'feat(web): tint the kind icon and the pull request badge on All tasks',
      at: Date.now() - 6 * 60_000,
    },
  ],
  changed: Object.fromEntries(
    Object.entries(TINT_CHANGES).map(([path, file]) => [
      path,
      { ...file, risk: path === TONE_PATH ? 'low' : 'normal', riskReason: null },
    ])
  ),
  unchanged: TINT_UNCHANGED,
  edits: new Map(),
};

export const SHINSA_TASK_ID = 'review-shinsa-tint';

function selectRepository(taskId: string) {
  return taskId === SHINSA_TASK_ID ? SHINSA : NORTHWIND;
}

function listFiles(repo: Repository, ref: string): Record<string, string> {
  const head = ref !== repo.base;
  const files: Record<string, string> = { ...repo.unchanged };
  for (const [path, file] of Object.entries(repo.changed)) {
    const content = head ? file.after : file.before;
    if (content !== null) files[path] = content;
  }
  if (head) for (const [path, content] of repo.edits) files[path] = content;
  return files;
}

export function recordFileWrite(taskId: string, write: FileWrite): FileWritten {
  const repo = selectRepository(taskId);
  const changed = listFiles(repo, repo.head)[write.path] !== write.content;
  repo.edits.set(write.path, write.content);
  return { path: write.path, changed };
}

export function lineOf(content: string, needle: string) {
  const index = content.split('\n').findIndex((line) => line.includes(needle));
  return index + 1;
}

function splitLines(content: string) {
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function diffLines(before: string[], after: string[]) {
  const table = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push(` ${before[i]}`);
      i += 1;
      j += 1;
    } else if (j < after.length && (i === before.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      out.push(`+${after[j]}`);
      j += 1;
    } else {
      out.push(`-${before[i]}`);
      i += 1;
    }
  }
  return out;
}

function createPatch(path: string, file: ChangedFile) {
  const before = file.before === null ? [] : splitLines(file.before);
  const after = splitLines(file.after);
  const lines = diffLines(before, after);
  const header = [
    `diff --git a/${path} b/${path}`,
    file.before === null ? 'new file mode 100644' : null,
    file.before === null ? '--- /dev/null' : `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${before.length === 0 ? 0 : 1},${before.length} +1,${after.length} @@`,
  ].filter((line) => line !== null);
  return {
    patch: `${[...header, ...lines].join('\n')}\n`,
    additions: lines.filter((line) => line.startsWith('+')).length,
    deletions: lines.filter((line) => line.startsWith('-')).length,
  };
}

function createDiff(repo: Repository): TaskDiff {
  return {
    base: repo.base,
    head: repo.head,
    files: Object.entries(repo.changed).map(([path, file]) => ({
      path,
      previousPath: null,
      status: file.before === null ? 'added' : 'modified',
      risk: file.risk,
      riskReason: file.riskReason,
      binary: false,
      ...createPatch(path, file),
    })),
  };
}

function createTree(repo: Repository, ref: string, dir: string): RepoTree {
  const prefix = dir === '' ? '' : `${dir}/`;
  const entries = new Map<string, RepoEntry>();
  for (const [path, content] of Object.entries(listFiles(repo, ref))) {
    if (!path.startsWith(prefix)) continue;
    const [name, ...rest] = path.slice(prefix.length).split('/');
    if (!name) continue;
    const child = `${prefix}${name}`;
    entries.set(
      child,
      rest.length > 0
        ? { name, path: child, kind: 'directory', size: null }
        : { name, path: child, kind: 'file', size: content.length }
    );
  }
  return { ref, dir, entries: [...entries.values()] };
}

function createContent(repo: Repository, ref: string, path: string): FileContent {
  const content = listFiles(repo, ref)[path] ?? null;
  return {
    ref,
    path,
    content,
    size: content?.length ?? 0,
    binary: false,
    tooLarge: false,
    missing: content === null,
    image: null,
  };
}

function createSearch(repo: Repository, ref: string, query: string): SearchResult {
  const needle = query.toLowerCase();
  const matches = Object.entries(listFiles(repo, ref)).flatMap(([path, content]) =>
    content.split('\n').flatMap((text, index) => {
      const column = text.toLowerCase().indexOf(needle);
      return column >= 0 ? [{ path, line: index + 1, column: column + 1, text }] : [];
    })
  );
  return { ref, matches, truncated: false, timedOut: false };
}

function createRefs(repo: Repository): TaskRefs {
  return {
    head: repo.head,
    base: repo.base,
    branch: repo.branch,
    defaultBranch: 'main',
    working: false,
    dirty: false,
    commits: repo.commits,
  };
}

export function answerCodeRead(taskId: string, name: string, params: URLSearchParams): unknown {
  const repo = selectRepository(taskId);
  const ref = params.get('ref') ?? repo.head;
  switch (name) {
    case 'refs':
      return createRefs(repo);
    case 'diff':
      return createDiff(repo);
    case 'blob':
      return createContent(repo, ref, params.get('path') ?? '');
    case 'tree':
      return createTree(repo, ref, params.get('dir') ?? '');
    case 'paths':
      return { ref, paths: Object.keys(listFiles(repo, ref)).sort(), truncated: false } satisfies RepoPaths;
    case 'search':
      return createSearch(repo, ref, params.get('q') ?? '');
    default:
      return null;
  }
}

export function listRepoPaths(taskId: string, ref: string) {
  return Object.keys(listFiles(selectRepository(taskId), ref)).sort();
}

export function listRepoDirs(taskId: string, ref: string) {
  const dirs = new Set(['']);
  for (const path of listRepoPaths(taskId, ref)) {
    const parts = path.split('/');
    for (let depth = 1; depth < parts.length; depth++) dirs.add(parts.slice(0, depth).join('/'));
  }
  return [...dirs];
}
