import {
  type FileChanged,
  type FileContent,
  type FileWrite,
  type FileWritten,
  type RepoPaths,
  type RepoTree,
  type SearchResult,
  type Task,
  type TaskDiff,
  type TaskRefs,
  WORKING_REF,
} from '@shinsa/core';
import * as React from 'react';
import type { FileSave } from '@/lib/code/edits.ts';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson, requestJsonOrConflict } from '@/lib/connection/http.ts';

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

const CACHE_LIMIT = 300;

const IDLE = { status: 'idle' } as const;

const LOADING = { status: 'loading' } as const;

const reads = new Map<string, Promise<unknown>>();

const settled = new Map<string, Loaded<unknown>>();

function remember<T>(key: string, create: () => Promise<T>): Promise<T> {
  const known = reads.get(key);
  if (known) return known as Promise<T>;
  const pending = create();
  reads.set(key, pending);
  pending.then(
    (value) => {
      if (reads.get(key) === pending) settled.set(key, { status: 'ready', value });
    },
    () => {
      if (reads.get(key) === pending) reads.delete(key);
    }
  );
  if (reads.size > CACHE_LIMIT) {
    const oldest = reads.keys().next().value ?? '';
    reads.delete(oldest);
    settled.delete(oldest);
  }
  return pending;
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
  return remember(key, () => requestJson<T>(key));
}

function selectSettled<T>(url: string | null, version: string): Loaded<T> {
  if (url === null) return IDLE;
  return (settled.get(resolveVersionedUrl(url, version)) as Loaded<T> | undefined) ?? LOADING;
}

export function useCodeRead<T>(url: string | null, version = ''): Loaded<T> {
  const key = url === null ? null : resolveVersionedUrl(url, version);
  const [loaded, setLoaded] = React.useState<{ url: string | null; key: string | null; value: Loaded<T> }>(
    () => ({ url, key, value: selectSettled<T>(url, version) })
  );
  React.useEffect(() => {
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
  if (loaded.key === key) return loaded.value;
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

export function useTaskDiff(task: Task, base: string | null, head: string | null) {
  const url = base === null || head === null ? null : resolveCodeUrl(task.id, 'diff', { base, head });
  return useCodeRead<TaskDiff>(url, head === null ? '' : resolveReadVersion(task, head));
}

export function useRepoSearch(task: Task, ref: string | null, search: CodeSearch) {
  const url =
    ref === null || !search.query
      ? null
      : resolveCodeUrl(task.id, 'search', {
          ref,
          q: search.query,
          regex: search.regex ? '1' : null,
          case: search.caseSensitive ? '1' : null,
          word: search.wholeWord ? '1' : null,
          glob: search.glob.trim() || null,
        });
  return useCodeRead<SearchResult>(url, ref === null ? '' : resolveReadVersion(task, ref));
}

export function resolveRawUrl(taskId: string, ref: string, path: string) {
  return resolveCodeUrl(taskId, 'raw', { ref, path });
}

export async function requestFileWrite(taskId: string, write: FileWrite): Promise<FileSave> {
  const answer = await requestJsonOrConflict<FileWritten, FileChanged>(resolveCodeUrl(taskId, 'file'), write);
  if (answer.conflict) return { kind: 'changed', content: answer.value.content };
  return { kind: 'saved', changed: answer.value.changed };
}
