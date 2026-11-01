import { describe, expect, it } from 'bun:test';
import type { FileContent, TaskDiff, TaskRefs } from '@shinsa/core';
import { renderHook, waitFor } from '@testing-library/react';
import { registerCodeSource, useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import {
  createSharedCodeSource,
  NO_SHARED_CODE,
  ONLY_CHANGES,
  resolveBaseContent,
  resolveSharedHead,
  SHARED_BASE,
  SHARED_HEAD,
} from '@/lib/share/code.ts';
import { createTask } from '../../support/state.ts';
import { DIFF } from './fixtures.ts';

const HEAD = ['const ttl = 24;', 'export const keep = true;', ''].join('\n');

const CHANGES = [
  DIFF,
  'diff --git a/src/new.ts b/src/new.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  'diff --git a/src/gone.ts b/src/gone.ts',
  'deleted file mode 100644',
  '--- a/src/gone.ts',
  '+++ /dev/null',
  '@@ -1 +0,0 @@',
  '-old',
  '',
].join('\n');

function reads(diff: string | null = DIFF, code: Record<string, string> | null = { 'src/keys.ts': HEAD }) {
  return {
    readDiff: diff === null ? null : () => Promise.resolve(diff),
    readCode: code === null ? null : () => Promise.resolve(JSON.stringify({ files: code })),
    branch: 'feat/keys',
  };
}

function blob(ref: string, path: string) {
  return new URLSearchParams({ ref, path });
}

describe('the shared code source', () => {
  it('answers the refs and the diff from the published diff, reading it once', async () => {
    let diffReads = 0;
    const source = createSharedCodeSource({
      ...reads(),
      readDiff: () => {
        diffReads += 1;
        return Promise.resolve(DIFF);
      },
    });
    const refs = (await source('refs', new URLSearchParams())) as TaskRefs;
    expect(refs).toMatchObject({ head: SHARED_HEAD, base: SHARED_BASE, branch: 'feat/keys', working: false });
    const diff = (await source(
      'diff',
      new URLSearchParams({ base: SHARED_BASE, head: SHARED_HEAD })
    )) as TaskDiff;
    expect(diff.files.map((file) => [file.path, file.additions, file.deletions])).toEqual([
      ['src/keys.ts', 1, 1],
    ]);
    const one = (await source('diff', new URLSearchParams({ path: 'src/other.ts' }))) as TaskDiff;
    expect(one.files).toEqual([]);
    expect(diffReads).toBe(1);
  });

  it('names its head after the pull request’s, so a new push reads the new diff', async () => {
    const pushed = (headSha: string) => createTask({ id: 't', pullRequest: { headSha } as never });
    expect(resolveSharedHead(pushed('abc'))).toBe(`${SHARED_HEAD}-abc`);
    expect(resolveSharedHead(createTask({ id: 't', pullRequest: null }))).toBe(`${SHARED_HEAD}-none`);
    const source = createSharedCodeSource({ ...reads(), head: resolveSharedHead(pushed('def')) });
    expect(((await source('refs', new URLSearchParams())) as TaskRefs).head).toBe(`${SHARED_HEAD}-def`);
    expect(((await source('diff', new URLSearchParams())) as TaskDiff).head).toBe(`${SHARED_HEAD}-def`);
  });

  it('opens a changed file whole on both sides, rebuilding the base from the published file and its diff', async () => {
    const source = createSharedCodeSource(reads());
    const head = (await source('blob', blob(SHARED_HEAD, 'src/keys.ts'))) as FileContent;
    expect(head).toMatchObject({ content: HEAD, missing: false, binary: false });
    const base = (await source('blob', blob(SHARED_BASE, 'src/keys.ts'))) as FileContent;
    expect(base.content).toBe(['const ttl = 24;', 'export const keep = false;', ''].join('\n'));
  });

  it('opens a new file and a removed one from their diff alone', async () => {
    const source = createSharedCodeSource(reads(CHANGES));
    expect(((await source('blob', blob(SHARED_HEAD, 'src/new.ts'))) as FileContent).content).toBe(
      'one\ntwo\n'
    );
    expect(((await source('blob', blob(SHARED_BASE, 'src/new.ts'))) as FileContent).missing).toBe(true);
    expect(((await source('blob', blob(SHARED_BASE, 'src/gone.ts'))) as FileContent).content).toBe('old\n');
    expect(((await source('blob', blob(SHARED_HEAD, 'src/gone.ts'))) as FileContent).missing).toBe(true);
  });

  it('shows a changed file as missing when its whole file was not published', async () => {
    const source = createSharedCodeSource(reads(DIFF, null));
    expect(((await source('blob', blob(SHARED_HEAD, 'src/keys.ts'))) as FileContent).missing).toBe(true);
    expect(((await source('blob', blob(SHARED_BASE, 'src/keys.ts'))) as FileContent).missing).toBe(true);
  });

  it('refuses files the task did not change, other reads, and everything when the task shares no code', async () => {
    const source = createSharedCodeSource(reads());
    await expect(source('blob', new URLSearchParams())).rejects.toThrow(ONLY_CHANGES);
    await expect(source('tree', new URLSearchParams())).rejects.toThrow(ONLY_CHANGES);
    const none = createSharedCodeSource(reads(null));
    await expect(none('refs', new URLSearchParams())).rejects.toThrow(NO_SHARED_CODE);
    await expect(none('diff', new URLSearchParams())).rejects.toThrow(NO_SHARED_CODE);
  });

  it('answers a registered task’s code reads without the network, until it is released', async () => {
    const task = createTask({ id: 'shared-code-1' });
    const release = registerCodeSource(task.id, createSharedCodeSource(reads()));
    const refs = renderHook(() => useTaskRefs(task));
    await waitFor(() => expect(refs.result.current.status).toBe('ready'));
    const diff = renderHook(() => useTaskDiff(task, SHARED_BASE, SHARED_HEAD));
    await waitFor(() => expect(diff.result.current.status).toBe('ready'));
    release();
    const other = registerCodeSource('shared-code-2', createSharedCodeSource(reads(null)));
    release();
    other();
  });
});

describe('rebuilding the base of a changed file', () => {
  it('undoes each hunk and keeps the lines around them', () => {
    const head = ['a', 'b', 'B2', 'c', 'd', 'e', 'f', 'g', 'h', 'X', ''].join('\n');
    const patch = [
      'diff --git a/f b/f',
      '--- a/f',
      '+++ b/f',
      '@@ -1,3 +1,4 @@',
      ' a',
      ' b',
      '+B2',
      ' c',
      '@@ -7,3 +8,3 @@',
      ' g',
      ' h',
      '-i',
      '+X',
    ].join('\n');
    expect(resolveBaseContent(head, patch)).toBe(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', ''].join('\n')
    );
    expect(resolveBaseContent('same\n', 'diff --git a/f b/f')).toBe('same\n');
  });
});
