import {
  type FileChanged,
  type FileContent,
  type FileWrite,
  type FileWritten,
  type RepoPaths,
  type RepoTree,
  type SearchLine,
  type SearchResult,
  type Task,
  type TaskDiff,
  type TaskRefs,
  WORKING_REF,
} from '@shinsa/core';
import * as React from 'react';
import type { FileSave } from '@/lib/code/edits.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson, requestJsonOrConflict, requestLines } from '@/lib/connection/http.ts';

export type Loaded<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

export interface CodeSearch {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  glob: string;
}

export const CODE_READ_LIMIT = 300;

export const CODE_SEARCH_LIMIT = 20;

const IDLE = { status: 'idle' } as const;

const LOADING = { status: 'loading' } as const;

export const CODE_READ_BUDGET = 16 * 1024 * 1024;

const reads = new Map<string, Promise<unknown>>();

const settled = new Map<string, Loaded<unknown>>();

const sizes = new Map<string, number>();

const latest = new Map<string, string>();

const newest = new Map<string, string>();

let settledSize = 0;

function touch<V>(map: Map<string, V>, key: string, value: V, limit = CODE_READ_LIMIT) {
  map.delete(key);
  map.set(key, value);
  if (map.size <= limit) return null;
  const oldest = map.keys().next().value ?? '';
  map.delete(oldest);
  return oldest;
}

export function resolveReadSize(value: unknown): number {
  let size = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (typeof next === 'string') size += next.length;
    else if (Array.isArray(next)) pending.push(...next);
    else if (next !== null && typeof next === 'object')
      for (const [key, inner] of Object.entries(next)) {
        size += key.length;
        pending.push(inner);
      }
    else size += 8;
  }
  return size;
}

function removeRead(key: string) {
  reads.delete(key);
  settled.delete(key);
  settledSize -= sizes.get(key) ?? 0;
  sizes.delete(key);
}

function recordRead(url: string, key: string, value: unknown) {
  const wanted = newest.get(url);
  if (wanted !== undefined && wanted !== key && latest.has(url)) {
    reads.delete(key);
    return;
  }
  settled.set(key, { status: 'ready', value });
  const size = resolveReadSize(value);
  sizes.set(key, size);
  settledSize += size;
  const previous = latest.get(url);
  if (previous !== undefined && previous !== key) removeRead(previous);
  touch(latest, url, key);
  for (const oldest of reads.keys()) {
    if (settledSize <= CODE_READ_BUDGET) return;
    if (oldest !== key && settled.has(oldest)) removeRead(oldest);
  }
}

function remember<T>(url: string, key: string, create: () => Promise<T>): Promise<T> {
  const known = reads.get(key);
  if (known) {
    touch(reads, key, known);
    return known as Promise<T>;
  }
  const pending = create();
  const evicted = touch(reads, key, pending);
  if (evicted !== null) removeRead(evicted);
  touch(newest, url, key);
  pending.then(
    (value) => {
      if (reads.get(key) === pending) recordRead(url, key, value);
    },
    () => {
      if (reads.get(key) === pending) reads.delete(key);
    }
  );
  return pending;
}

export function holdLoaded<T>(shown: Loaded<T>, next: Loaded<T>): Loaded<T> {
  return next.status === 'loading' && shown.status === 'ready' ? shown : next;
}

export function resolveCodeUrl(taskId: string, name: string, params: Record<string, string | null> = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== '') query.set(key, value);
  const search = query.toString();
  return `/api/tasks/${encodeURIComponent(taskId)}/${name}${search ? `?${search}` : ''}`;
}

function resolveVersionedUrl(url: string, version: string) {
  if (!version) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function requestCodeRead<T>(url: string, version = ''): Promise<T> {
  const key = resolveVersionedUrl(url, version);
  return remember(url, key, () => requestJson<T>(key));
}

function selectSettled<T>(url: string | null, version: string): Loaded<T> {
  if (url === null) return IDLE;
  const known = settled.get(resolveVersionedUrl(url, version)) ?? settled.get(latest.get(url) ?? '');
  return (known as Loaded<T> | undefined) ?? LOADING;
}

export function useCodeRead<T>(url: string | null, version = ''): Loaded<T> {
  const key = url === null ? null : resolveVersionedUrl(url, version);
  const [loaded, setLoaded] = React.useState<{ url: string | null; key: string | null; value: Loaded<T> }>(
    () => ({ url, key, value: selectSettled<T>(url, version) })
  );
  React.useLayoutEffect(() => {
    if (key === null || url === null) return;
    let alive = true;
    requestCodeRead<T>(url, version).then(
      (value) => {
        if (alive) setLoaded({ url, key, value: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (alive) setLoaded({ url, key, value: { status: 'error', message: describeFailure(error) } });
      }
    );
    return () => {
      alive = false;
    };
  }, [key, url, version]);
  if (loaded.key === key && loaded.value.status !== 'loading') return loaded.value;
  const known = selectSettled<T>(url, version);
  if (known.status === 'loading' && loaded.url === url) return loaded.value;
  return known;
}

export function resolveRefsVersion(task: Task) {
  return [
    task.stage,
    task.branch ?? '',
    task.worktreePath ?? '',
    task.pushedSha ?? '',
    task.pullRequest?.headSha ?? '',
    task.pullRequest?.state ?? '',
    task.phaseReports.length,
    task.fixRounds,
  ].join('|');
}

export function resolveReadVersion(task: Task, ref: string) {
  return ref === WORKING_REF ? String(task.updatedAt) : '';
}

export function useTaskRefs(task: Task) {
  return useCodeRead<TaskRefs>(resolveCodeUrl(task.id, 'refs'), resolveRefsVersion(task));
}

export function requestTaskRefs(task: Task) {
  return requestCodeRead<TaskRefs>(resolveCodeUrl(task.id, 'refs'), resolveRefsVersion(task));
}

export function requestRepoTree(task: Task, ref: string, dir: string) {
  return requestCodeRead<RepoTree>(
    resolveCodeUrl(task.id, 'tree', { ref, dir }),
    resolveReadVersion(task, ref)
  );
}

export function requestFileContent(task: Task, ref: string, path: string) {
  return requestCodeRead<FileContent>(
    resolveCodeUrl(task.id, 'blob', { ref, path }),
    resolveReadVersion(task, ref)
  );
}

export function requestTaskDiff(task: Task, base: string, head: string) {
  return requestCodeRead<TaskDiff>(
    resolveCodeUrl(task.id, 'diff', { base, head }),
    resolveReadVersion(task, head)
  );
}

export function requestRepoPaths(task: Task, ref: string) {
  return requestCodeRead<RepoPaths>(resolveCodeUrl(task.id, 'paths', { ref }), resolveReadVersion(task, ref));
}

export function useRepoPaths(task: Task, ref: string | null) {
  const url = ref === null ? null : resolveCodeUrl(task.id, 'paths', { ref });
  return useCodeRead<RepoPaths>(url, ref === null ? '' : resolveReadVersion(task, ref));
}

export function useRepoTree(task: Task, ref: string, dir: string) {
  return useCodeRead<RepoTree>(resolveCodeUrl(task.id, 'tree', { ref, dir }), resolveReadVersion(task, ref));
}

export function useFileContent(task: Task, ref: string | null, path: string | null) {
  const url = ref === null || path === null ? null : resolveCodeUrl(task.id, 'blob', { ref, path });
  return useCodeRead<FileContent>(url, ref === null ? '' : resolveReadVersion(task, ref));
}

export function useRepoTrees(task: Task, ref: string, dirs: readonly string[]) {
  const version = resolveReadVersion(task, ref);
  const urls = dirs.map((dir) => resolveCodeUrl(task.id, 'tree', { ref, dir }));
  const key = urls.join('\n');
  const [failures, setFailures] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [, settle] = React.useReducer((count: number) => count + 1, 0);
  React.useLayoutEffect(() => {
    let alive = true;
    for (const url of key.split('\n')) {
      requestCodeRead<RepoTree>(url, version).then(
        () => {
          if (alive) settle();
        },
        (error: unknown) => {
          if (alive) setFailures((current) => new Map(current).set(url, describeFailure(error)));
        }
      );
    }
    return () => {
      alive = false;
    };
  }, [key, version]);
  return new Map(
    dirs.map((dir, index): [string, Loaded<RepoTree>] => {
      const url = urls[index] ?? '';
      const failure = failures.get(url);
      return [dir, failure ? { status: 'error', message: failure } : selectSettled<RepoTree>(url, version)];
    })
  );
}

export function useTaskDiff(task: Task, base: string | null, head: string | null) {
  const url = base === null || head === null ? null : resolveCodeUrl(task.id, 'diff', { base, head });
  return useCodeRead<TaskDiff>(url, head === null ? '' : resolveReadVersion(task, head));
}

export function requestFileDiff(task: Task, base: string, head: string, path: string) {
  return requestCodeRead<TaskDiff>(
    resolveCodeUrl(task.id, 'diff', { base, head, path }),
    resolveReadVersion(task, head)
  );
}

export function useFileDiff(task: Task, base: string | null, head: string | null, path: string) {
  const url = base === null || head === null ? null : resolveCodeUrl(task.id, 'diff', { base, head, path });
  return useCodeRead<TaskDiff>(url, head === null ? '' : resolveReadVersion(task, head));
}

export interface SearchView {
  loaded: Loaded<SearchResult>;
  searching: boolean;
}

const searches = new Map<string, SearchResult>();

export function resolveSearchUrl(task: Task, ref: string | null, search: CodeSearch) {
  if (ref === null || !search.query) return null;
  return resolveCodeUrl(task.id, 'search', {
    ref,
    q: search.query,
    regex: search.regex ? '1' : null,
    case: search.caseSensitive ? '1' : null,
    word: search.wholeWord ? '1' : null,
    glob: search.glob.trim() || null,
  });
}

export function applySearchLine(
  current: SearchResult,
  line: Exclude<SearchLine, { kind: 'failed' }>
): SearchResult {
  if (line.kind === 'matches') return { ...current, matches: [...current.matches, ...line.matches] };
  return { ...line.result, matches: current.matches };
}

export function useRepoSearch(task: Task, ref: string | null, search: CodeSearch): SearchView {
  const url = resolveSearchUrl(task, ref, search);
  const key = url === null ? null : resolveVersionedUrl(url, resolveReadVersion(task, ref ?? ''));
  const [view, setView] = React.useState<{ key: string | null; view: SearchView }>({
    key: null,
    view: { loaded: IDLE, searching: false },
  });
  React.useEffect(() => {
    if (key === null || searches.has(key)) return;
    let alive = true;
    let result: SearchResult = { ref: ref ?? '', matches: [], truncated: false, timedOut: false };
    let frame: number | null = null;
    let failure: string | null = null;
    const show = (searching: boolean) => {
      if (alive) setView({ key, view: { loaded: { status: 'ready', value: result }, searching } });
    };
    const fail = (message: string) => {
      if (alive) setView({ key, view: { loaded: { status: 'error', message }, searching: false } });
    };
    setView((current) => ({
      key,
      view: { loaded: holdLoaded(current.view.loaded, LOADING), searching: true },
    }));
    requestLines<SearchLine>(key, undefined, (line) => {
      if (line.kind === 'failed') {
        failure = line.message;
        return;
      }
      result = applySearchLine(result, line);
      if (line.kind === 'done' || frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        show(true);
      });
    }).then(
      () => {
        if (frame !== null) cancelAnimationFrame(frame);
        if (failure !== null) {
          fail(failure);
          return;
        }
        touch(searches, key, result, CODE_SEARCH_LIMIT);
        show(false);
      },
      (error: unknown) => fail(describeFailure(error))
    );
    return () => {
      alive = false;
    };
  }, [key, ref]);
  if (key === null) return { loaded: IDLE, searching: false };
  const finished = searches.get(key);
  if (finished) return { loaded: { status: 'ready', value: finished }, searching: false };
  return view.key === key ? view.view : { loaded: holdLoaded(view.view.loaded, LOADING), searching: true };
}

export function resolveRawUrl(taskId: string, ref: string, path: string) {
  return resolveCodeUrl(taskId, 'raw', { ref, path });
}

export async function requestFileWrite(taskId: string, write: FileWrite): Promise<FileSave> {
  const answer = await requestJsonOrConflict<FileWritten, FileChanged>(resolveCodeUrl(taskId, 'file'), write);
  if (answer.conflict) return { kind: 'changed', content: answer.value.content };
  return { kind: 'saved', changed: answer.value.changed };
}
