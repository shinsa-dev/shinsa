import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_LIMITS, type FileChanged, type FileWritten } from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { createWorktree } from '../../src/git/index.ts';
import { startServer } from '../../src/http/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { Workspaces } from '../../src/workspaces/index.ts';
import {
  createGitRepo,
  createTempDir,
  createTestConfig,
  createTestOnboarding,
  git,
  writeFiles,
} from '../helpers/index.ts';

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

const HEAD_TEXT = 'export const value = 2;\n';

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
    workspaces: new Workspaces({ dataDir: config.dataDir, worktreesDir: config.worktreesDir }),
  });
  running.push(http.stop);
  const { repo } = await createGitRepo({ files: { 'src/app.ts': 'export const value = 1;\n' } });
  const worktree = await createWorktree(repo, config.worktreesDir, 'task-edit01', 'feat/edit', null);
  writeFiles(worktree.path, { 'src/app.ts': HEAD_TEXT });
  await git(worktree.path, 'commit', '-qam', 'feat: phase one');
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
    branch: 'feat/edit',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: worktree.path, branch: worktree.branch });
  const save = (body: unknown, task = taskId) =>
    fetch(`http://127.0.0.1:${http.server.port}/api/tasks/${task}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { engine, worktree: worktree.path, taskId, save };
}

describe('saving a file from the editor', () => {
  test('writes the working copy, records the edit, and puts it back when the text is the commit’s again', async () => {
    const { engine, worktree, taskId, save } = await startWithTask();
    const edited = 'export const value = 3;\n';
    const response = await save({ path: 'src/app.ts', content: edited, base: HEAD_TEXT });
    expect(response.status).toBe(200);
    expect((await response.json()) as FileWritten).toEqual({ path: 'src/app.ts', changed: true });
    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toBe(edited);
    expect(engine.state.tasks[taskId]?.editedPaths).toEqual(['src/app.ts']);
    const back = await save({ path: 'src/app.ts', content: HEAD_TEXT, base: edited });
    expect((await back.json()) as FileWritten).toEqual({ path: 'src/app.ts', changed: false });
    expect(engine.state.tasks[taskId]?.editedPaths).toEqual([]);
  });

  test('a file that changed on disk since the editor read it is not overwritten', async () => {
    const { worktree, save } = await startWithTask();
    writeFiles(worktree, { 'src/app.ts': 'export const value = 9;\n' });
    const response = await save({ path: 'src/app.ts', content: 'mine\n', base: HEAD_TEXT });
    expect(response.status).toBe(409);
    expect((await response.json()) as FileChanged).toEqual({
      error: { code: 'file_changed', message: 'src/app.ts changed on disk since the editor read it.' },
      content: 'export const value = 9;\n',
    });
    expect(readFileSync(join(worktree, 'src/app.ts'), 'utf8')).toBe('export const value = 9;\n');
  });

  test('a new file is created with its folders when the editor expects none', async () => {
    const { worktree, save } = await startWithTask();
    const response = await save({ path: 'src/new/b.ts', content: 'b\n', base: null });
    expect((await response.json()) as FileWritten).toEqual({ path: 'src/new/b.ts', changed: true });
    expect(readFileSync(join(worktree, 'src/new/b.ts'), 'utf8')).toBe('b\n');
  });

  test('refuses paths outside the working copy, bad bodies and files too large to keep', async () => {
    const { worktree, save } = await startWithTask();
    symlinkSync('/tmp', join(worktree, 'out'));
    const refusal = async (body: unknown) =>
      ((await (await save(body)).json()) as { error: { code: string } }).error.code;
    expect(await refusal({ path: '../escape.ts', content: 'x', base: null })).toBe('path_invalid');
    expect(await refusal({ path: 'out/escape.ts', content: 'x', base: null })).toBe('path_invalid');
    expect(await refusal({ path: 'src/app.ts', content: 3, base: null })).toBe('body_invalid');
    expect(await refusal({ path: 'src/app.ts', content: 'x', base: 4 })).toBe('body_invalid');
    expect(
      await refusal({ path: 'src/app.ts', content: 'x'.repeat(CODE_LIMITS.blobBytes + 1), base: HEAD_TEXT })
    ).toBe('file_too_large');
  });

  test('refuses a task that is finished or has no code', async () => {
    const { engine, taskId, save } = await startWithTask();
    const missing = await save({ path: 'src/app.ts', content: 'x', base: null }, 'no-such-task');
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('code_unavailable');
    await engine.dispatch({ type: 'task.cancel', taskId });
    const response = await save({ path: 'src/app.ts', content: 'x', base: HEAD_TEXT });
    expect(await response.json()).toEqual({
      error: { code: 'edit_refused', message: 'This task is finished, so its code is read-only.' },
    });
  });
});
