import { describe, expect, it } from 'bun:test';
import { resolveSharedTaskId, resolveSharedView, resolveSourceTaskId } from '@/lib/share/view.ts';
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
    expect(resolveSourceTaskId(view.task.id)).toBe('task-1');
    expect(resolveSourceTaskId('task-1')).toBe('task-1');
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

  it('carries the task’s gates, runs, repository and project, each under the shared task', () => {
    const { state } = resolveSharedView(source());
    expect(Object.values(state.gates).map((gate) => [gate.id, gate.taskId])).toEqual([
      ['gate-1', 'shared-task-1'],
    ]);
    expect(Object.values(state.runs).map((run) => [run.id, run.taskId])).toEqual([
      ['run-1', 'shared-task-1'],
    ]);
    expect(state.repos['repo-1']?.name).toBe('app');
    expect(state.projects['project-1']?.name).toBe('Superwall');
  });

  it('points a Default share’s runs at their streamed transcripts, and a Status share’s at none', () => {
    const transcripts = {
      ...source(),
      resolveFileUrl: (id: string) =>
        ({ 'transcript-run-1-0': '/t/1', 'transcript-run-1-1': '/t/2' })[id] ?? null,
    };
    expect(
      resolveSharedView({ ...transcripts, shared: createSharedTask({ preset: 'status' }) }).transcripts
    ).toEqual({});
    const everything = { ...transcripts, shared: createSharedTask({ preset: 'standard' }) };
    expect(resolveSharedView(everything).transcripts).toEqual({ 'run-1': ['/t/1', '/t/2'] });
    expect(resolveSharedView({ ...everything, resolveFileUrl: () => null }).transcripts).toEqual({});
  });

  it('leaves the repository and project out when the task has none', () => {
    const { state } = resolveSharedView({
      ...source(),
      shared: createSharedTask({ repo: null, project: null }),
    });
    expect(state.repos).toEqual({});
    expect(state.projects).toEqual({});
  });

  it('reads the diff only for a task that shares its code', () => {
    expect(resolveSharedView(source()).diffUrl).toBe('/files/diff');
    expect(resolveSharedView(source(false)).diffUrl).toBeNull();
  });
});
