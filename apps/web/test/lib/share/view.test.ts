import { describe, expect, it } from 'bun:test';
import { resolveSharedTaskId, resolveSharedView } from '@/lib/share/view.ts';
import { createSharedTask } from './fixtures.ts';

const FILES: Record<string, string> = { 'shot-1': '/files/shot-1', diff: '/files/diff' };

function source(code = true) {
  return {
    shared: createSharedTask({ code }),
    updatedAt: 5,
    resolveFileUrl: (id: string) => FILES[id] ?? null,
  };
}

describe('a shared view', () => {
  it('keeps the shared task under an id of its own, so it never reads the real task’s code', () => {
    const view = resolveSharedView(source());
    expect(view.task.id).toBe(resolveSharedTaskId('task-1'));
    expect(view.task.id).toBe('shared-task-1');
    expect(Object.keys(view.state.tasks)).toEqual(['shared-task-1']);
    expect(view.updatedAt).toBe(5);
  });

  it('points shared files at their published address, drops one that was not published and keeps public links', () => {
    const view = resolveSharedView(source());
    expect(Object.values(view.state.evidence).map((item) => [item.id, item.uri, item.taskId])).toEqual([
      ['shot-1', '/files/shot-1', 'shared-task-1'],
      ['link', 'https://preview.example.dev', 'shared-task-1'],
    ]);
  });

  it('reads the diff only for a task that shares its code', () => {
    expect(resolveSharedView(source()).diffUrl).toBe('/files/diff');
    expect(resolveSharedView(source(false)).diffUrl).toBeNull();
  });
});
