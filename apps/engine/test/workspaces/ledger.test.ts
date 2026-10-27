import { describe, expect, test } from 'bun:test';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claimChanges,
  createLedger,
  endBaseline,
  forgetTask,
  LedgerStore,
  listOwnedPaths,
  readDirtyState,
  recordCommitted,
  startBaseline,
} from '../../src/workspaces/ledger.ts';
import { createGitRepo, createTempDir, git, writeFiles } from '../helpers/index.ts';

describe('the workspace ledger', () => {
  test('reads every uncommitted path with its content, including new, deleted and odd ones', async () => {
    const { path } = await createGitRepo({
      files: { 'gone.txt': 'x\n', 'kept.txt': 'k\n', 'moved.txt': 'm\n' },
    });
    writeFiles(path, { 'new dir/with space.txt': 'n\n', 'kept.txt': 'k2\n' });
    await git(path, 'rm', '-q', 'gone.txt');
    await git(path, 'mv', 'moved.txt', 'renamed.txt');
    symlinkSync('kept.txt', join(path, 'link'));
    const dirty = await readDirtyState(path);
    expect(Object.keys(dirty).sort()).toEqual([
      'gone.txt',
      'kept.txt',
      'link',
      'moved.txt',
      'new dir/with space.txt',
      'renamed.txt',
    ]);
    expect(dirty['gone.txt']).toBe('missing');
    expect(dirty.link).not.toBe(dirty['kept.txt']);
    writeFiles(path, { 'kept.txt': 'k3\n' });
    expect((await readDirtyState(path))['kept.txt']).not.toBe(dirty['kept.txt']);
  });

  test('a nested repository reads as one changed folder', async () => {
    const { path } = await createGitRepo();
    mkdirSync(join(path, 'nested'));
    await git(join(path, 'nested'), 'init', '-q');
    writeFileSync(join(path, 'nested', 'inner.txt'), 'x');
    const dirty = await readDirtyState(path);
    expect(Object.keys(dirty)).toEqual(['nested/']);
    expect(dirty['nested/']).toMatch(/^[0-9a-f]{40}$/);
  });

  test('changes since a run started belong to its task; what was there before stays out', () => {
    let ledger = startBaseline(createLedger(), 'task-1', { 'mine.txt': 'u1' });
    expect(startBaseline(ledger, 'task-1', {})).toBe(ledger);
    const claimed = claimChanges(ledger, 'task-1', { 'mine.txt': 'u1', 'a.txt': 'a1', 'b.txt': 'b1' });
    expect(claimed.conflicts).toEqual([]);
    ledger = claimed.ledger;
    expect(listOwnedPaths(ledger, 'task-1', { 'a.txt': 'a1', 'b.txt': 'b1', 'mine.txt': 'u1' })).toEqual([
      'a.txt',
      'b.txt',
    ]);
    const reverted = claimChanges(ledger, 'task-1', { 'mine.txt': 'u1', 'a.txt': 'a1' });
    expect(reverted.ledger.owners).toEqual({ 'a.txt': { taskId: 'task-1', hash: 'a1' } });
  });

  test('changing your file or another task’s pending one is a conflict', () => {
    const ledger = {
      owners: { 'other.txt': { taskId: 'task-2', hash: 'o1' } },
      baselines: { 'task-1': { 'mine.txt': 'u1', 'other.txt': 'o1' } },
    };
    const claimed = claimChanges(ledger, 'task-1', { 'mine.txt': 'u2', 'other.txt': 'o2' });
    expect(claimed.conflicts).toEqual(['mine.txt', 'other.txt']);
    expect(claimed.ledger.owners).toEqual(ledger.owners);
  });

  test('a task without a running agent claims nothing new', () => {
    const ledger = createLedger();
    expect(claimChanges(ledger, 'task-1', { 'a.txt': 'a1' })).toEqual({ ledger, conflicts: [] });
  });

  test('a commit gives the paths up and measures what comes next from there', () => {
    const ledger = {
      owners: { 'a.txt': { taskId: 'task-1', hash: 'a1' }, 'b.txt': { taskId: 'task-1', hash: 'b1' } },
      baselines: { 'task-1': {} },
    };
    expect(recordCommitted(ledger, 'task-1', ['a.txt'], { 'b.txt': 'b1' })).toEqual({
      owners: { 'b.txt': { taskId: 'task-1', hash: 'b1' } },
      baselines: { 'task-1': { 'b.txt': 'b1' } },
    });
    expect(recordCommitted({ ...ledger, baselines: {} }, 'task-1', ['a.txt'], {}).baselines).toEqual({});
    expect(endBaseline(ledger, 'task-1').baselines).toEqual({});
  });

  test('forgetting a task keeps others’ changes and discards only its own edits nobody touched since', () => {
    const ledger = {
      owners: {
        'a.txt': { taskId: 'task-1', hash: 'a1' },
        'b.txt': { taskId: 'task-1', hash: 'b1' },
        'c.txt': { taskId: 'task-2', hash: 'c1' },
      },
      baselines: { 'task-1': {} },
    };
    expect(forgetTask(ledger, 'task-1', { 'a.txt': 'a1', 'b.txt': 'b2', 'c.txt': 'c1' })).toEqual({
      ledger: { owners: { 'c.txt': { taskId: 'task-2', hash: 'c1' } }, baselines: {} },
      untouched: ['a.txt'],
    });
  });

  test('is kept per repository in the data folder and starts empty', () => {
    const store = new LedgerStore(createTempDir());
    expect(store.read('repo/1')).toEqual(createLedger());
    const ledger = { owners: { 'a.txt': { taskId: 'task-1', hash: 'a1' } }, baselines: {} };
    store.write('repo/1', ledger);
    expect(store.read('repo/1')).toEqual(ledger);
    const dir = createTempDir();
    writeFiles(join(dir, 'workspaces'), { 'repo-2.json': '{}' });
    expect(new LedgerStore(dir).read('repo-2')).toEqual(createLedger());
  });
});
