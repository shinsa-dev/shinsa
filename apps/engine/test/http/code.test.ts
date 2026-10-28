import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_LIMITS, type SearchLine, type ShinsaState, type TaskDiff, type TaskRefs } from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { createWorktree, removeWorktree } from '../../src/git/index.ts';
import { startServer } from '../../src/http/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { GitButlerStrategy } from '../../src/workspaces/gitbutler.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  git,
  startGitButler,
  writeFiles,
} from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);

async function startWithTask() {
  const config = createTestConfig(createTempDir());
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
  });
  running.push(http.stop);
  const base = `http://127.0.0.1:${http.server.port}`;
  const { repo } = await createGitRepo({
    files: { 'src/app.ts': 'export const value = 1;\n', 'big.txt': 'x'.repeat(CODE_LIMITS.blobBytes + 1) },
  });
  const baseSha = await git(repo.path, 'rev-parse', 'HEAD');
  const worktree = await createWorktree(repo, config.worktreesDir, 'task-code01', 'feat/code', null);
  writeFiles(worktree.path, { 'src/app.ts': 'export const value = 2;\n' });
  writeFileSync(join(worktree.path, 'logo.png'), PNG);
  await git(worktree.path, 'add', '-A');
  await git(worktree.path, 'commit', '-q', '-m', 'feat: phase one');
  const head = await git(worktree.path, 'rev-parse', 'HEAD');
  await engine.dispatch({ type: 'repo.register', repo: { ...repo, checkCommands: [] }, projectName: null });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Change the value', repoId });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Change the value',
    repoId,
    size: 'small',
    branch: 'feat/code',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: worktree.path, branch: worktree.branch });
  const call = (path: string, init: RequestInit = {}) => fetch(`${base}/api/tasks/${taskId}/${path}`, init);
  const json = async <T>(path: string) => (await (await call(path)).json()) as T;
  return { engine, repo, worktree: worktree.path, taskId, head, baseSha, call, json, base };
}

describe('code reads', () => {
  test('refs pin the head, the base and the commits between, and are never cached', async () => {
    const { call, head, baseSha } = await startWithTask();
    const response = await call('refs');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const refs = (await response.json()) as TaskRefs;
    expect(refs).toMatchObject({ head, base: baseSha, branch: 'feat/code', working: true, dirty: false });
    expect(refs.commits.map((commit) => commit.subject)).toEqual(['feat: phase one']);
  });

  test('takes the task’s handle as well as its id', async () => {
    const { engine, taskId, base, head } = await startWithTask();
    const handle = engine.state.tasks[taskId]?.handle ?? '';
    expect(handle).not.toBe('');
    const refs = (await (await fetch(`${base}/api/tasks/${handle}/refs`)).json()) as TaskRefs;
    expect(refs.head).toBe(head);
    const blob = await fetch(`${base}/api/tasks/${handle}/blob?path=src/app.ts&ref=${head}`);
    expect(blob.status).toBe(200);
    expect((await fetch(`${base}/api/tasks/NOPE-1/refs`)).status).toBe(404);
  });

  test('a read at a named commit is immutable and answered from the browser cache the second time', async () => {
    const { call, head } = await startWithTask();
    const first = await call(`paths?ref=${head}`);
    expect(first.headers.get('cache-control')).toContain('immutable');
    expect(((await first.json()) as { paths: string[] }).paths).toEqual([
      'README.md',
      'big.txt',
      'logo.png',
      'src/app.ts',
    ]);
    const tag = first.headers.get('etag') ?? '';
    const again = await call(`paths?ref=${head}`, { headers: { 'if-none-match': tag } });
    expect(again.status).toBe(304);
    const unpinned = await call('paths');
    expect(unpinned.headers.get('cache-control')).toBe('no-store');
  });

  test('reads a folder, a file and an image at a commit', async () => {
    const { call, json, head } = await startWithTask();
    expect((await json<{ entries: { name: string }[] }>(`tree?ref=${head}&dir=src`)).entries).toMatchObject([
      { name: 'app.ts', kind: 'file' },
    ]);
    expect(await json(`blob?ref=${head}&path=src/app.ts`)).toMatchObject({
      content: 'export const value = 2;\n',
      binary: false,
    });
    expect(await json(`blob?ref=${head}&path=big.txt`)).toMatchObject({ tooLarge: true, content: null });
    expect(await json(`blob?ref=${head}&path=logo.png`)).toMatchObject({ binary: true, image: 'image/png' });
    const image = await call(`raw?ref=${head}&path=logo.png`);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    expect((await call(`raw?ref=${head}&path=src/app.ts`)).status).toBe(400);
    expect((await call(`raw?ref=${head}&path=missing.png`)).status).toBe(404);
  });

  test('refuses paths that leave the repository and refs that are not commits', async () => {
    const { call, worktree, head } = await startWithTask();
    const outside = createTempDir();
    writeFiles(outside, { 'secret.txt': 'secret' });
    symlinkSync(join(outside, 'secret.txt'), join(worktree, 'leak.txt'));
    const paths = ['../../../../etc/passwd', '/etc/passwd', 'src/../README.md', 'a%00b', './README.md', ''];
    for (const path of paths) {
      const response = await call(`blob?ref=${head}&path=${path}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'path_invalid' } });
    }
    expect((await call('tree?ref=working&dir=..')).status).toBe(400);
    expect(await (await call('blob?ref=working&path=leak.txt')).json()).toMatchObject({
      error: { code: 'path_invalid' },
    });
    for (const [ref, code] of [
      ['main', 'ref_invalid'],
      ['HEAD~1', 'ref_invalid'],
      [`--output=${join(outside, 'x')}`, 'ref_invalid'],
      ['a'.repeat(40), 'ref_unknown'],
    ]) {
      expect(
        await (await call(`blob?ref=${encodeURIComponent(ref ?? '')}&path=README.md`)).json()
      ).toMatchObject({
        error: { code },
      });
    }
  });

  test('the working copy shows the agent’s uncommitted edits, uncached', async () => {
    const { call, json, worktree } = await startWithTask();
    writeFiles(worktree, { 'src/app.ts': 'export const value = 3;\n', 'src/new.ts': 'export {};\n' });
    const response = await call('blob?ref=working&path=src/app.ts');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ref: 'working', content: 'export const value = 3;\n' });
    expect((await json<{ paths: string[] }>('paths?ref=working')).paths).toContain('src/new.ts');
    expect(
      (await json<{ entries: { name: string }[] }>('tree?ref=working&dir=src')).entries.map((e) => e.name)
    ).toEqual(['app.ts', 'new.ts']);
    const image = await call('raw?ref=working&path=logo.png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    const diff = await json<TaskDiff>('diff');
    expect(diff.head).toBe('working');
    expect(diff.files.map((file) => file.path).sort()).toEqual(['logo.png', 'src/app.ts', 'src/new.ts']);
  });

  test('a diff between two commits is pinned and cached; the default follows the working copy', async () => {
    const { call, head, baseSha } = await startWithTask();
    const pinned = await call(`diff?base=${baseSha}&head=${head}`);
    expect(pinned.headers.get('cache-control')).toContain('immutable');
    const diff = (await pinned.json()) as TaskDiff;
    expect(diff).toMatchObject({ base: baseSha, head });
    expect(diff.files.map((file) => [file.path, file.binary])).toEqual([
      ['src/app.ts', false],
      ['logo.png', true],
    ]);
    const tag = pinned.headers.get('etag') ?? '';
    expect(
      (await call(`diff?base=${baseSha}&head=${head}`, { headers: { 'if-none-match': tag } })).status
    ).toBe(304);
    expect((await call(`diff?base=main&head=${head}`)).status).toBe(400);
  });

  test('a diff names one file with its whole patch, by its path and the path it was renamed from', async () => {
    const { call, json, head, baseSha, worktree } = await startWithTask();
    const one = await json<TaskDiff>(`diff?base=${baseSha}&head=${head}&path=src/app.ts`);
    expect(one.files.map((file) => [file.path, file.patchOmitted, file.patch.includes('value = 2')])).toEqual(
      [['src/app.ts', false, true]]
    );
    await git(worktree, 'mv', 'big.txt', 'moved.txt');
    await git(worktree, 'commit', '-q', '-m', 'refactor: move');
    const moved = await git(worktree, 'rev-parse', 'HEAD');
    const renamed = await json<TaskDiff>(
      `diff?base=${baseSha}&head=${moved}&path=moved.txt&previous=big.txt`
    );
    expect(renamed.files).toMatchObject([{ path: 'moved.txt', previousPath: 'big.txt', status: 'renamed' }]);
    const working = await json<TaskDiff>(`diff?base=${baseSha}&head=working&path=src/app.ts`);
    expect(working.files.map((file) => file.path)).toEqual(['src/app.ts']);
    expect((await call(`diff?base=${baseSha}&head=${head}&path=../x`)).status).toBe(400);
  });

  test('streams a search as lines of matches and a last line with how it ended', async () => {
    const { call, head } = await startWithTask();
    const lines = async (path: string) =>
      (await (await call(path, { headers: { accept: 'application/x-ndjson' } })).text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as SearchLine);
    const found = await lines(`search?ref=${head}&q=value`);
    expect(found.at(-1)).toMatchObject({
      kind: 'done',
      result: { ref: head, truncated: false, timedOut: false },
    });
    expect(
      found.flatMap((line) => (line.kind === 'matches' ? line.matches : [])).map((match) => match.path)
    ).toEqual(['src/app.ts']);
    expect((await lines('search?ref=working&q=value')).at(-1)).toMatchObject({ kind: 'done' });
    expect(await lines(`search?ref=${'f'.repeat(40)}&q=value`)).toEqual([
      { kind: 'failed', code: 'ref_unknown', message: 'The repository has no such commit.' },
    ]);
    expect(await lines('search?ref=working&q=(&regex=1&case=1')).toMatchObject([
      { kind: 'failed', code: 'read_failed' },
    ]);
  });

  test('searches at a commit and in the working copy, and refuses a search with nothing to find', async () => {
    const { json, call, worktree, head } = await startWithTask();
    expect((await json<{ matches: { path: string }[] }>(`search?ref=${head}&q=value`)).matches).toMatchObject(
      [{ path: 'src/app.ts', line: 1 }]
    );
    writeFiles(worktree, { 'notes.md': 'the value moved\n' });
    const working = await json<{ matches: { path: string }[] }>('search?ref=working&q=VALUE&glob=*.md');
    expect(working.matches.map((match) => match.path)).toEqual(['notes.md']);
    const exact = await json<{ matches: unknown[] }>(`search?ref=${head}&q=VALUE&case=1`);
    expect(exact.matches).toEqual([]);
    expect((await json<{ matches: unknown[] }>(`search?ref=${head}&q=val.e&regex=1`)).matches).toHaveLength(
      1
    );
    expect((await json<{ matches: unknown[] }>(`search?ref=${head}&q=valu&word=1`)).matches).toEqual([]);
    expect((await call(`search?ref=${head}`)).status).toBe(400);
    expect((await call(`search?ref=${head}&q=${'x'.repeat(CODE_LIMITS.queryLength + 1)}`)).status).toBe(400);
    for (const glob of ['-x', ':(top)*', 'x'.repeat(201)]) {
      expect(
        await (await call(`search?ref=${head}&q=a&glob=${encodeURIComponent(glob)}`)).json()
      ).toMatchObject({
        error: { code: 'glob_invalid' },
      });
    }
  });

  test('a merged task whose worktree is gone keeps its code, read from the branch', async () => {
    const { engine, repo, worktree, taskId, call, json, head } = await startWithTask();
    await removeWorktree(repo, worktree);
    const refs = await json<TaskRefs>('refs');
    expect(refs).toMatchObject({ head, working: false });
    expect(await json(`blob?ref=${head}&path=src/app.ts`)).toMatchObject({
      content: 'export const value = 2;\n',
    });
    expect((await json<TaskDiff>('diff')).head).toBe(head);
    expect(await (await call('blob?ref=working&path=src/app.ts')).json()).toMatchObject({
      error: { code: 'ref_invalid' },
    });
    const state = engine.state as ShinsaState;
    const task = state.tasks[taskId];
    if (task) state.tasks[taskId] = { ...task, branch: 'feat/deleted', worktreePath: null };
    expect(await (await call('refs')).json()).toMatchObject({ error: { code: 'code_unavailable' } });
  });

  test('a task without a repository, or no task at all, has no code', async () => {
    const { engine, taskId, base } = await startWithTask();
    expect((await fetch(`${base}/api/tasks/nope/refs`)).status).toBe(404);
    const state = engine.state as ShinsaState;
    const task = state.tasks[taskId];
    if (task) state.tasks[taskId] = { ...task, repoId: null };
    expect((await fetch(`${base}/api/tasks/${taskId}/paths`)).status).toBe(404);
  });
});

async function startWithButlerTask() {
  const config = createTestConfig(createTempDir());
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
  });
  running.push(http.stop);
  const made = await createGitRepo({
    files: { 'src/app.ts': 'export const value = 1;\n', 'src/other.ts': 'export const other = 1;\n' },
  });
  const baseSha = await git(made.path, 'rev-parse', 'HEAD');
  await startGitButler(made.path);
  const repo = { ...made.repo, workspace: 'gitbutler' as const, checkCommands: [] };
  const strategy = new GitButlerStrategy(config.dataDir);
  await engine.dispatch({ type: 'repo.register', repo, projectName: null });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Change the value', repoId });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Change the value',
    repoId,
    size: 'small',
    branch: 'feat/value',
    waitsOn: [],
  });
  const registered = { ...repo, id: repoId };
  const checkout = await strategy.prepare(
    registered,
    createTask({ id: taskId, branch: 'feat/value', worktreePath: null })
  );
  await engine.dispatch({ type: 'worktree.ready', taskId, path: checkout.path, branch: checkout.branch });
  const task = engine.state.tasks[taskId] ?? createTask();
  const release = await strategy.claim(registered, task);
  writeFiles(made.path, { 'src/app.ts': 'export const value = 2;\n' });
  await strategy.commit(registered, task, 'feat: phase one');
  await release();
  const base = `http://127.0.0.1:${http.server.port}`;
  const json = async <T>(path: string) =>
    (await (await fetch(`${base}/api/tasks/${taskId}/${path}`)).json()) as T;
  return { engine, strategy, repo: registered, task, path: made.path, baseSha, json };
}

describe('code reads in a GitButler workspace', () => {
  test('files the task owns are read from disk, so your edit shows after a reload, and the rest from its branch', async () => {
    const { strategy, repo, task, path, baseSha, json } = await startWithButlerTask();
    const head = await git(path, 'rev-parse', 'feat/value');
    expect(await json<TaskRefs>('refs')).toMatchObject({ head, base: baseSha, working: true, dirty: false });

    await strategy.writeEdit(repo, task, 'src/app.ts', () => {
      writeFileSync(join(path, 'src/app.ts'), 'export const value = 3;\n');
      return true;
    });
    await strategy.writeEdit(repo, task, 'src/added.ts', () => {
      writeFileSync(join(path, 'src/added.ts'), 'export const added = true;\n');
      return true;
    });
    writeFiles(path, { 'src/other.ts': 'export const other = 9;\n', 'notes.txt': 'mine\n' });

    expect(await json<TaskRefs>('refs')).toMatchObject({ head, working: true, dirty: true });
    expect(await json('blob?ref=working&path=src/app.ts')).toMatchObject({
      ref: 'working',
      content: 'export const value = 3;\n',
    });
    expect(await json('blob?ref=working&path=src/other.ts')).toMatchObject({
      ref: 'working',
      content: 'export const other = 1;\n',
    });
    expect((await json<{ paths: string[] }>('paths?ref=working')).paths).toEqual([
      'README.md',
      'src/added.ts',
      'src/app.ts',
      'src/other.ts',
    ]);
    expect(
      (await json<{ entries: { name: string }[] }>('tree?ref=working&dir=src')).entries.map((e) => e.name)
    ).toEqual(['added.ts', 'app.ts', 'other.ts']);
    const found = await json<{ matches: { path: string }[] }>('search?ref=working&q=export');
    expect(found.matches.map((match) => match.path)).toEqual(['src/added.ts', 'src/app.ts', 'src/other.ts']);
    expect((await json<{ matches: unknown[] }>('search?ref=working&q=other%20%3D%209')).matches).toEqual([]);
    const diff = await json<TaskDiff>('diff');
    expect(diff.head).toBe('working');
    expect(diff.files.map((file) => [file.path, file.patch.includes('value = 3')])).toEqual([
      ['src/added.ts', false],
      ['src/app.ts', true],
    ]);

    await strategy.writeEdit(repo, task, 'src/added.ts', () => {
      rmSync(join(path, 'src/added.ts'));
      return true;
    });
    await strategy.writeEdit(repo, task, 'src/app.ts', () => {
      rmSync(join(path, 'src/app.ts'));
      return true;
    });
    expect((await json<{ paths: string[] }>('paths?ref=working')).paths).toEqual([
      'README.md',
      'src/other.ts',
    ]);
  });

  test('with nothing of its own uncommitted, the working copy is the branch', async () => {
    const { json, path } = await startWithButlerTask();
    writeFiles(path, { 'src/other.ts': 'export const other = 9;\n' });
    expect((await json<TaskDiff>('diff')).files.map((file) => file.path)).toEqual(['src/app.ts']);
    expect((await json<{ matches: unknown[] }>('search?ref=working&q=other%20%3D%209')).matches).toEqual([]);
  });
});
