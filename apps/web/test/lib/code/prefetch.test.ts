import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { DiffFile, Task, TaskDiff, TaskRefs } from '@shinsa/core';
import type { PairSource } from '@/lib/code/pane.ts';
import {
  claimPrefetch,
  listOtherRefs,
  prefetchAncestors,
  prefetchFile,
  prefetchFolder,
  prefetchOtherRefs,
  prefetchPair,
  prefetchSnippets,
  prefetchTaskCode,
  requestPairSource,
  SNIPPET_PREFETCH_LIMIT,
  scheduleIdle,
} from '@/lib/code/prefetch.ts';
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

describe('prefetchTaskCode', () => {
  it('reads the refs, the diff, the root folder and the first changed file', async () => {
    expect(await prefetchTaskCode(nextTask(), '')).toBe('src/a.ts');
    expect(requests).toEqual([
      'refs',
      `diff ${HEAD}`,
      `tree ${HEAD}`,
      `paths ${HEAD}`,
      `blob ${HEAD} src/a.ts`,
      `blob ${BASE} src/a.ts`,
      `tree ${HEAD} src`,
    ]);
  });

  it('reads the diff the Review tab shows too when the Code tab opens on the working copy', async () => {
    refs.working = true;
    expect(await prefetchTaskCode(nextTask(), '?ref=working')).toBe('src/a.ts');
    expect(requests).toContain('diff working');
    expect(requests).toContain(`diff ${HEAD}`);
    expect(requests).toContain('paths working');
  });

  it('reads both sides of a changed file, and only the old one of a deleted file', async () => {
    diff.files = [createFile('src/gone.ts', { status: 'removed' })];
    expect(await prefetchTaskCode(nextTask(), '?mode=changes')).toBe('src/gone.ts');
    expect(requests).toContain(`blob ${BASE} src/gone.ts`);
    expect(requests.some((request) => request.startsWith(`blob ${HEAD}`))).toBe(false);
  });

  it('opens nothing when the change touches no file', async () => {
    diff.files = [];
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

describe('prefetchFile and prefetchFolder', () => {
  it('read a file’s sides and a folder ahead of a click, and shrug off a failure', async () => {
    const task = nextTask();
    prefetchFile(task, refs, HEAD, { kind: 'diff', path: 'src/a.ts' }, diff);
    prefetchFile(task, refs, HEAD, { kind: 'file', path: 'src/b.ts' }, null);
    prefetchFolder(task, HEAD, 'src');
    await Bun.sleep(5);
    expect(requests).toEqual([
      `blob ${HEAD} src/a.ts`,
      `blob ${BASE} src/a.ts`,
      `blob ${HEAD} src/b.ts`,
      `tree ${HEAD} src`,
    ]);
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    prefetchFile(nextTask(), refs, HEAD, { kind: 'file', path: 'src/c.ts' }, null);
    prefetchFolder(nextTask(), HEAD, 'lib');
    await Bun.sleep(5);
  });
});

describe('the side by side pair read ahead', () => {
  function withContent(byPath: Record<string, { content: string | null; binary?: boolean }>) {
    const fallback = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      const known = byPath[url.searchParams.get('path') ?? ''];
      if (!known) return fallback(input);
      return Response.json({
        ref: HEAD,
        path: '',
        content: known.content,
        size: known.content?.length ?? 9,
        binary: known.binary ?? false,
        tooLarge: false,
        missing: false,
        image: null,
      });
    }) as typeof fetch;
  }

  it('is both sides of a changed file under the key its editor shows it with', async () => {
    expect(await requestPairSource(nextTask(), refs, HEAD, { kind: 'diff', path: 'src/a.ts' }, diff)).toEqual(
      {
        key: `${HEAD}\0src/a.ts\0diff`,
        path: 'src/a.ts',
        content: 'x',
        original: 'x',
      }
    );
  });

  it('is nothing for a file with one side, a plain file, a binary file or one too large to show', async () => {
    diff.files.push(createFile('src/logo.png', { binary: true }), createFile('src/big.ts'));
    withContent({
      'src/logo.png': { content: null, binary: true },
      'src/big.ts': { content: 'x'.repeat(2_000_000) },
    });
    const task = nextTask();
    for (const file of [
      { kind: 'diff', path: 'src/new.ts' },
      { kind: 'file', path: 'src/a.ts' },
      { kind: 'diff', path: 'src/logo.png' },
      { kind: 'diff', path: 'src/big.ts' },
    ] as const) {
      expect(await requestPairSource(task, refs, HEAD, file, diff)).toBeNull();
    }
  });

  it('hands a pair to be built when the browser is idle, and nothing when there is none or the read fails', async () => {
    const built: PairSource[] = [];
    const build = (source: PairSource) => built.push(source);
    prefetchPair(nextTask(), refs, HEAD, { kind: 'diff', path: 'src/a.ts' }, diff, build);
    prefetchPair(nextTask(), refs, HEAD, { kind: 'diff', path: 'src/new.ts' }, diff, build);
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    prefetchPair(nextTask(), refs, HEAD, { kind: 'diff', path: 'src/a.ts' }, diff, build);
    await Bun.sleep(350);
    expect(built.map((source) => source.path)).toEqual(['src/a.ts']);
  });
});

describe('the other refs', () => {
  it('lists the head, the working copy and the base, without the one shown', () => {
    expect(listOtherRefs(refs, HEAD)).toEqual([BASE]);
    expect(listOtherRefs({ ...refs, working: true }, BASE)).toEqual([HEAD, 'working']);
    expect(listOtherRefs({ ...refs, base: null }, HEAD)).toEqual([]);
  });

  it('reads each other ref’s root folder, diff and open file with its folders', async () => {
    const task = nextTask();
    prefetchOtherRefs(task, refs, HEAD, { kind: 'diff', path: 'src/a.ts' }, diff, true);
    prefetchOtherRefs(nextTask(), refs, HEAD, null, null, false);
    await Bun.sleep(5);
    expect(requests).toContain(`tree ${BASE}`);
    expect(requests).toContain(`diff ${BASE}`);
    expect(requests).toContain(`blob ${BASE} src/a.ts`);
    expect(requests).toContain(`tree ${BASE} src`);
  });

  it('reads the folders above a file', async () => {
    prefetchAncestors(nextTask(), HEAD, 'src/deep/file.ts');
    await Bun.sleep(5);
    expect(requests).toEqual([`tree ${HEAD} src`, `tree ${HEAD} src/deep`]);
  });
});

describe('prefetchSnippets', () => {
  it('reads the lines the Review tab opens: the file at the head, and its own diff when the task diff left its patch out', async () => {
    diff.files = [
      createFile('src/a.ts', { patch: '@@ -1 +1 @@\n-a\n+b' }),
      createFile('src/big.ts', { patchOmitted: true }),
    ];
    prefetchSnippets(nextTask(), ['src/a.ts', 'src/big.ts', 'src/unchanged.ts', 'src/a.ts']);
    await Bun.sleep(5);
    expect(requests).toContain(`blob ${HEAD} src/a.ts`);
    expect(requests).toContain(`diff ${HEAD} src/big.ts`);
    expect(requests).toContain(`diff ${HEAD} src/unchanged.ts`);
    expect(requests).not.toContain(`diff ${HEAD} src/a.ts`);
    expect(requests.filter((request) => request === `blob ${HEAD} src/a.ts`)).toHaveLength(1);
  });

  it('reads at most a few files, nothing without a base, and nothing for no paths', async () => {
    const paths = Array.from({ length: SNIPPET_PREFETCH_LIMIT + 4 }, (_, index) => `f${index}.ts`);
    prefetchSnippets(nextTask(), paths);
    await Bun.sleep(5);
    expect(requests.filter((request) => request.startsWith('blob'))).toHaveLength(SNIPPET_PREFETCH_LIMIT);
    requests.length = 0;
    prefetchSnippets(nextTask(), []);
    refs.base = null;
    prefetchSnippets(nextTask(), ['src/a.ts']);
    await Bun.sleep(5);
    expect(requests).toEqual(['refs']);
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    prefetchSnippets(nextTask(), ['src/a.ts']);
    await Bun.sleep(5);
  });
});

describe('scheduleIdle', () => {
  it('runs when the browser is idle, or a moment later without idle callbacks, and can be cancelled', async () => {
    const scope = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const saved = { request: scope.requestIdleCallback, cancel: scope.cancelIdleCallback };
    const runs: string[] = [];
    scope.requestIdleCallback = (run: () => void) => setTimeout(run, 0);
    scope.cancelIdleCallback = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle);
    scheduleIdle(() => runs.push('idle'));
    scheduleIdle(() => runs.push('cancelled'))();
    delete scope.requestIdleCallback;
    scheduleIdle(() => runs.push('later'));
    scheduleIdle(() => runs.push('never'))();
    await Bun.sleep(350);
    expect(runs).toEqual(['idle', 'later']);
    scope.requestIdleCallback = saved.request;
    scope.cancelIdleCallback = saved.cancel;
  });
});
