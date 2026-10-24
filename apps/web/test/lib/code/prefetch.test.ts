import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, ReviewFinding, Task, TaskDiff, TaskRefs, WorkReport } from '@shinsa/core';
import { claimPrefetch, prefetchTaskCode } from '@/lib/code/prefetch.ts';
import { createTask } from '../../support/state.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function createFile(path: string, overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    path,
    previousPath: null,
    status: 'modified',
    additions: 1,
    deletions: 1,
    risk: 'normal',
    riskReason: null,
    binary: false,
    patch: '',
    ...overrides,
  };
}

let refs: TaskRefs;
let diff: TaskDiff;
const requests: string[] = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  refs = {
    head: HEAD,
    base: BASE,
    branch: 'b',
    defaultBranch: 'main',
    working: false,
    dirty: false,
    commits: [],
  };
  diff = {
    base: BASE,
    head: HEAD,
    files: [createFile('src/a.ts'), createFile('src/new.ts', { status: 'added' })],
  };
  requests.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const name = url.pathname.split('/').at(-1);
    requests.push(
      `${name} ${url.searchParams.get('ref') ?? url.searchParams.get('head') ?? ''} ${url.searchParams.get('path') ?? url.searchParams.get('dir') ?? ''}`.trim()
    );
    if (name === 'refs') return Response.json(refs);
    if (name === 'diff') return Response.json(diff);
    if (name === 'tree') return Response.json({ ref: HEAD, dir: '', entries: [] });
    return Response.json({
      ref: HEAD,
      path: '',
      content: 'x',
      size: 1,
      binary: false,
      tooLarge: false,
      missing: false,
      image: null,
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let count = 0;

function nextTask(overrides: Partial<Task> = {}) {
  count += 1;
  return createTask({ id: `prefetch-${count}`, repoId: 'repo-1', stage: 'awaiting_review', ...overrides });
}

const REPORT: WorkReport = {
  headline: 'h',
  sections: [
    {
      title: 't',
      summary: 's',
      spots: [{ file: 'src/new.ts', start: 1, end: 1, attention: 'normal', why: 'w' }],
    },
  ],
  checks: [],
  judgementCalls: [],
};

describe('prefetchTaskCode', () => {
  it('reads the refs, the diff, the root folder and the first spot the review opens', async () => {
    expect(await prefetchTaskCode(nextTask({ report: REPORT }), '')).toBe('src/new.ts');
    expect(requests).toEqual(['refs', `diff ${HEAD}`, `tree ${HEAD}`, `blob ${HEAD} src/new.ts`]);
  });

  it('reads both sides of a changed file, and only the old one of a deleted file', async () => {
    diff.files = [createFile('src/gone.ts', { status: 'removed' })];
    expect(await prefetchTaskCode(nextTask(), '?mode=changes')).toBe('src/gone.ts');
    expect(requests).toContain(`blob ${BASE} src/gone.ts`);
    expect(requests.some((request) => request.startsWith(`blob ${HEAD}`))).toBe(false);
  });

  it('falls back to the riskiest changes, then to the findings, when there is no report', async () => {
    diff.files = [createFile('src/a.ts', { risk: 'high', patch: '@@ -1 +1 @@\n-a\n+b\n' })];
    expect(await prefetchTaskCode(nextTask(), '')).toBe('src/a.ts');
    expect(requests).toContain(`blob ${BASE} src/a.ts`);
    diff.files = [];
    const finding: ReviewFinding = {
      severity: 'blocking',
      file: 'src/elsewhere.ts',
      line: 3,
      message: 'Broken',
    };
    expect(await prefetchTaskCode(nextTask({ findings: [finding] }), '')).toBe('src/elsewhere.ts');
    expect(await prefetchTaskCode(nextTask(), '')).toBeNull();
    expect(await prefetchTaskCode(nextTask(), '?mode=changes')).toBeNull();
  });

  it('reads the file the URL names, at the ref it names', async () => {
    refs.commits = [{ sha: BASE, subject: 'older', at: 1 }];
    expect(await prefetchTaskCode(nextTask(), `?file=README.md&ref=${BASE}`)).toBe('README.md');
    expect(requests).toContain(`blob ${BASE} README.md`);
  });

  it('only browses files for a task without changes, and opens nothing by itself', async () => {
    refs.base = null;
    expect(await prefetchTaskCode(nextTask({ stage: 'planning', report: null }), '')).toBeNull();
    expect(requests.some((request) => request.startsWith('diff'))).toBe(false);
    expect(await prefetchTaskCode(nextTask(), '?mode=files')).toBeNull();
  });
});

describe('claimPrefetch', () => {
  it('prefetches a task once per version of its code, again after a failure', () => {
    const task = nextTask();
    const release = claimPrefetch(task);
    expect(release).not.toBeNull();
    expect(claimPrefetch(task)).toBeNull();
    release?.();
    expect(claimPrefetch(task)).not.toBeNull();
    expect(claimPrefetch({ ...task, stage: 'merged' })).not.toBeNull();
  });
});
