import {
  createState,
  type Evidence,
  SHARE_DIFF_FILE,
  SHARED_EVIDENCE_PREFIX,
  type SharedTask,
  type ShinsaState,
  type Task,
} from '@shinsa/core';

const SHARED_TASK_PREFIX = 'shared-';

export interface SharedSource {
  shared: SharedTask;
  updatedAt: number;
  resolveFileUrl: (fileId: string) => string | null;
}

export interface SharedView {
  state: ShinsaState;
  task: Task;
  shared: SharedTask;
  updatedAt: number;
  diffUrl: string | null;
}

export function resolveSharedTaskId(taskId: string) {
  return `${SHARED_TASK_PREFIX}${taskId}`;
}

function resolveSharedEvidence(item: Evidence, taskId: string, source: SharedSource): Evidence | null {
  if (!item.uri.startsWith(SHARED_EVIDENCE_PREFIX)) return { ...item, taskId };
  const url = source.resolveFileUrl(item.uri.slice(SHARED_EVIDENCE_PREFIX.length));
  return url ? { ...item, taskId, uri: url } : null;
}

export function resolveSharedView(source: SharedSource): SharedView {
  const id = resolveSharedTaskId(source.shared.task.id);
  const task: Task = { ...source.shared.task, id };
  const state = createState();
  state.tasks = { [id]: task };
  state.evidence = Object.fromEntries(
    source.shared.evidence.flatMap((item) => {
      const evidence = resolveSharedEvidence(item, id, source);
      return evidence ? [[evidence.id, evidence]] : [];
    })
  );
  return {
    state,
    task,
    shared: source.shared,
    updatedAt: source.updatedAt,
    diffUrl: source.shared.code ? source.resolveFileUrl(SHARE_DIFF_FILE) : null,
  };
}
