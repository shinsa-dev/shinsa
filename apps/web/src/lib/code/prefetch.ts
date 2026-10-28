import { type FileContent, type Task, type TaskDiff, type TaskRefs, WORKING_REF } from '@shinsa/core';
import { TOKEN_PRIORITY, tokenClient } from '@/lib/code/editor/tokens.ts';
import { type CodeFileRef, type CodeMode, parseCodeLocation } from '@/lib/code/location.ts';
import { type PairSource, resolvePaneContent, resolvePaneKey, resolveTextGuard } from '@/lib/code/pane.ts';
import { resolveViewRef } from '@/lib/code/refs.ts';
import { hasOneSide, resolveFileSource } from '@/lib/code/source.ts';
import { listAncestors } from '@/lib/code/tree.ts';
import {
  type Loaded,
  requestFileContent,
  requestFileDiff,
  requestRepoPaths,
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

function requestText(task: Task, ref: string, path: string, priority: number) {
  return requestFileContent(task, ref, path).then((file) => {
    if (file.content !== null) tokenClient.prefetch(path, file.content, priority);
    return file;
  });
}

function requestFile(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  priority: number = TOKEN_PRIORITY.prefetch
) {
  const source = resolveFileSource(file, diff);
  const basePath = source.basePath ?? source.baselinePath;
  return Promise.all([
    source.headPath ? requestText(task, ref, source.headPath, priority) : null,
    basePath && refs.base ? requestText(task, refs.base, basePath, priority) : null,
  ]);
}

function skipFailure() {
  return null;
}

export function prefetchFile(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  priority: number = TOKEN_PRIORITY.prefetch
) {
  void requestFile(task, refs, ref, file, diff, priority).then(undefined, skipFailure);
}

function resolveLoaded(file: FileContent | null): Loaded<FileContent> {
  return file ? { status: 'ready', value: file } : { status: 'idle' };
}

export async function requestPairSource(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null
): Promise<PairSource | null> {
  const source = resolveFileSource(file, diff);
  if (!source.change || hasOneSide(source)) return null;
  const [head, base] = await requestFile(task, refs, ref, file, diff);
  const content = resolvePaneContent({
    headPath: source.headPath,
    basePath: source.basePath,
    diffing: true,
    head: resolveLoaded(head),
    base: resolveLoaded(base),
  });
  if (content.kind !== 'text' || content.original === null) return null;
  if (resolveTextGuard(file.path, [content.content, content.original])) return null;
  return {
    key: resolvePaneKey(ref, file),
    path: file.path,
    content: content.content,
    original: content.original,
  };
}

export function prefetchPair(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef,
  diff: TaskDiff | null,
  build: (source: PairSource) => void
) {
  void requestPairSource(task, refs, ref, file, diff).then((source) => {
    if (source) scheduleIdle(() => build(source));
  }, skipFailure);
}

const NEIGHBOUR_DELAY_MS = 300;

export function scheduleIdle(run: () => void) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: NEIGHBOUR_DELAY_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(run, NEIGHBOUR_DELAY_MS);
  return () => clearTimeout(timer);
}

export function prefetchFolder(task: Task, ref: string, dir: string) {
  void requestRepoTree(task, ref, dir).then(undefined, skipFailure);
}

function requestAncestors(task: Task, ref: string, path: string) {
  return Promise.all(listAncestors(path).map((dir) => requestRepoTree(task, ref, dir)));
}

export function prefetchAncestors(task: Task, ref: string, path: string) {
  void requestAncestors(task, ref, path).then(undefined, skipFailure);
}

export function listOtherRefs(refs: TaskRefs, ref: string) {
  const all = [refs.head, refs.working ? WORKING_REF : null, refs.base];
  return [...new Set(all)].filter((each): each is string => each !== null && each !== ref);
}

export function prefetchOtherRefs(
  task: Task,
  refs: TaskRefs,
  ref: string,
  file: CodeFileRef | null,
  diff: TaskDiff | null,
  reviewing: boolean
) {
  for (const other of listOtherRefs(refs, ref)) {
    void Promise.all([
      requestRepoTree(task, other, ''),
      reviewing && refs.base ? requestTaskDiff(task, refs.base, other) : null,
      file ? requestFile(task, refs, other, file, diff) : null,
      file ? requestAncestors(task, other, file.path) : null,
    ]).then(undefined, skipFailure);
  }
}

export async function prefetchTaskCode(task: Task, search: string): Promise<string | null> {
  const params = new URLSearchParams(search);
  const location = parseCodeLocation((name) => params.get(name), listCodeModes(task));
  const refs = await requestTaskRefs(task);
  const ref = resolveViewRef(location.ref, refs);
  const reviewing = listCodeModes(task).includes('changes');
  const [diff] = await Promise.all([
    reviewing && refs.base ? requestTaskDiff(task, refs.base, ref) : null,
    refs.base && ref !== refs.head ? requestTaskDiff(task, refs.base, refs.head) : null,
    requestRepoTree(task, ref, ''),
    requestRepoPaths(task, ref),
  ]);
  const file = location.active ?? selectFirstFile(location.mode, diff);
  if (!file) return null;
  await Promise.all([requestFile(task, refs, ref, file, diff), requestAncestors(task, ref, file.path)]);
  return file.path;
}

export const SNIPPET_PREFETCH_LIMIT = 8;

async function requestSnippets(task: Task, paths: readonly string[]) {
  const refs = await requestTaskRefs(task);
  if (!refs.base) return;
  const diff = await requestTaskDiff(task, refs.base, refs.head);
  const base = refs.base;
  await Promise.all(
    [...new Set(paths)].slice(0, SNIPPET_PREFETCH_LIMIT).map((path) => {
      const listed = diff.files.find((file) => file.path === path);
      return Promise.all([
        requestFileContent(task, refs.head, path),
        listed && !listed.patchOmitted ? null : requestFileDiff(task, base, refs.head, path),
      ]);
    })
  );
}

export function prefetchSnippets(task: Task, paths: readonly string[]) {
  if (paths.length === 0) return;
  void requestSnippets(task, paths).then(undefined, skipFailure);
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
