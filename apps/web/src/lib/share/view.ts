import {
  createState,
  type Evidence,
  hasShareGroup,
  resolveShareTranscriptFile,
  SHARE_CODE_FILE,
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
  codeUrl: string | null;
  transcripts: Record<string, string[]>;
}

export function resolveSharedTaskId(taskId: string) {
  return `${SHARED_TASK_PREFIX}${taskId}`;
}

export function resolveSourceTaskId(taskId: string) {
  return taskId.startsWith(SHARED_TASK_PREFIX) ? taskId.slice(SHARED_TASK_PREFIX.length) : taskId;
}

function resolveSharedEvidence(item: Evidence, taskId: string, source: SharedSource): Evidence | null {
  if (!item.uri.startsWith(SHARED_EVIDENCE_PREFIX)) return { ...item, taskId };
  const url = source.resolveFileUrl(item.uri.slice(SHARED_EVIDENCE_PREFIX.length));
  return url ? { ...item, taskId, uri: url } : null;
}

function listTranscriptUrls(source: SharedSource) {
  if (!hasShareGroup(source.shared.preset, 'live')) return {};
  return Object.fromEntries(
    source.shared.runs.flatMap((run) => {
      const urls: string[] = [];
      for (let page = 0; ; page += 1) {
        const url = source.resolveFileUrl(resolveShareTranscriptFile(run.id, page));
        if (!url) break;
        urls.push(url);
      }
      return urls.length > 0 ? [[run.id, urls]] : [];
    })
  );
}

export function resolveSharedView(source: SharedSource): SharedView {
  const id = resolveSharedTaskId(source.shared.task.id);
  const task: Task = { ...source.shared.task, id };
  const state = createState();
  state.tasks = { [id]: task };
  state.gates = Object.fromEntries(source.shared.gates.map((gate) => [gate.id, { ...gate, taskId: id }]));
  state.runs = Object.fromEntries(source.shared.runs.map((run) => [run.id, { ...run, taskId: id }]));
  const { repo, project } = source.shared;
  if (repo) state.repos = { [repo.id]: repo };
  if (project) state.projects = { [project.id]: project };
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
    codeUrl: source.shared.code ? source.resolveFileUrl(SHARE_CODE_FILE) : null,
    transcripts: listTranscriptUrls(source),
  };
}
