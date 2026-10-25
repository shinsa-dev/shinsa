import type { Task, TaskDiff, TaskRefs } from '@shinsa/core';
import { type CodeFileRef, type CodeMode, parseCodeLocation } from '@/lib/code/location.ts';
import { resolveViewRef } from '@/lib/code/refs.ts';
import { resolveFileSource } from '@/lib/code/source.ts';
import {
  requestFileContent,
  requestRepoTree,
  requestTaskDiff,
  requestTaskRefs,
  resolveRefsVersion,
} from '@/lib/connection/code.ts';
import { listCodeModes } from '@/lib/tasks/tabs.ts';

function selectFirstFile(mode: CodeMode, diff: TaskDiff | null): CodeFileRef | null {
  const changed = mode === 'changes' ? diff?.files[0] : undefined;
  return changed ? { kind: 'diff', path: changed.path } : null;
}

function requestFile(task: Task, refs: TaskRefs, ref: string, file: CodeFileRef, diff: TaskDiff | null) {
  const source = resolveFileSource(file, diff);
  return Promise.all([
    source.headPath ? requestFileContent(task, ref, source.headPath) : null,
    source.basePath && refs.base ? requestFileContent(task, refs.base, source.basePath) : null,
  ]);
}

export async function prefetchTaskCode(task: Task, search: string): Promise<string | null> {
  const params = new URLSearchParams(search);
  const location = parseCodeLocation((name) => params.get(name), listCodeModes(task));
  const refs = await requestTaskRefs(task);
  const ref = resolveViewRef(location.ref, refs);
  const reviewing = listCodeModes(task).includes('changes');
  const [diff] = await Promise.all([
    reviewing && refs.base ? requestTaskDiff(task, refs.base, ref) : null,
    requestRepoTree(task, ref, ''),
  ]);
  const file = location.active ?? selectFirstFile(location.mode, diff);
  if (!file) return null;
  await requestFile(task, refs, ref, file, diff);
  return file.path;
}

const prefetched = new Set<string>();

export function claimPrefetch(task: Task) {
  const key = `${task.id}:${resolveRefsVersion(task)}`;
  if (prefetched.has(key)) return null;
  prefetched.add(key);
  return () => {
    prefetched.delete(key);
  };
}
