import { describe, expect, it } from 'bun:test';
import type { TaskDiff, TaskRefs } from '@shinsa/core';
import { renderHook, waitFor } from '@testing-library/react';
import { registerCodeSource, useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import { createSharedCodeSource, NO_SHARED_CODE, ONLY_CHANGES, SHARED_BASE, SHARED_HEAD } from '@/lib/share/code.ts';
import { createTask } from '../../support/state.ts';
import { DIFF } from './fixtures.ts';

describe('the shared code source', () => {
  it('answers the refs and the diff from the published diff, reading it once', async () => {
    let reads = 0;
    const source = createSharedCodeSource(() => {
      reads += 1;
      return Promise.resolve(DIFF);
    }, 'feat/keys');
    const refs = (await source('refs', new URLSearchParams())) as TaskRefs;
    expect(refs).toMatchObject({ head: SHARED_HEAD, base: SHARED_BASE, branch: 'feat/keys', working: false });
    const diff = (await source('diff', new URLSearchParams({ base: SHARED_BASE, head: SHARED_HEAD }))) as TaskDiff;
    expect(diff.files.map((file) => [file.path, file.additions, file.deletions])).toEqual([['src/keys.ts', 1, 1]]);
    const one = (await source('diff', new URLSearchParams({ path: 'src/other.ts' }))) as TaskDiff;
    expect(one.files).toEqual([]);
    expect(reads).toBe(1);
  });

  it('refuses whole files, and everything when the task shares no code', async () => {
    const source = createSharedCodeSource(() => Promise.resolve(DIFF), null);
    await expect(source('blob', new URLSearchParams())).rejects.toThrow(ONLY_CHANGES);
    const none = createSharedCodeSource(null, null);
    await expect(none('refs', new URLSearchParams())).rejects.toThrow(NO_SHARED_CODE);
    await expect(none('diff', new URLSearchParams())).rejects.toThrow(NO_SHARED_CODE);
  });

  it('answers a registered task’s code reads without the network, until it is released', async () => {
    const task = createTask({ id: 'shared-code-1' });
    const release = registerCodeSource(task.id, createSharedCodeSource(() => Promise.resolve(DIFF), null));
    const refs = renderHook(() => useTaskRefs(task));
    await waitFor(() => expect(refs.result.current.status).toBe('ready'));
    const diff = renderHook(() => useTaskDiff(task, SHARED_BASE, SHARED_HEAD));
    await waitFor(() => expect(diff.result.current.status).toBe('ready'));
    release();
    const other = registerCodeSource('shared-code-2', createSharedCodeSource(null, null));
    release();
    other();
  });
});
