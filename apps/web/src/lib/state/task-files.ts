import type { TaskDiff } from '@shinsa/core';
import * as React from 'react';
import { describeFailure } from './commands.ts';

export type Loaded<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; message: string };

const CACHE_LIMIT = 200;

const IDLE = { status: 'idle' } as const;

const LOADING = { status: 'loading' } as const;

const diffs = new Map<string, Promise<TaskDiff>>();

const files = new Map<string, Promise<string | null>>();

export async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = (await response.json().catch(() => null)) as T | { error?: { message?: string } } | null;
  if (body && typeof body === 'object' && 'error' in body && body.error) {
    throw new Error(body.error.message ?? `Shinsa answered with status ${response.status}.`);
  }
  if (!response.ok || body === null) throw new Error(`Shinsa answered with status ${response.status}.`);
  return body as T;
}

function remember<T>(cache: Map<string, Promise<T>>, key: string, create: () => Promise<T>) {
  const known = cache.get(key);
  if (known) return known;
  const pending = create();
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value ?? '');
  return pending;
}

function useLoaded<T>(resource: string | null, revision: number, create: () => Promise<T>): Loaded<T> {
  const key = resource === null ? null : `${resource}:${revision}`;
  const [loaded, setLoaded] = React.useState<{ resource: string | null; value: Loaded<T> }>({
    resource,
    value: resource === null ? IDLE : LOADING,
  });
  const latest = React.useRef(create);
  latest.current = create;
  React.useEffect(() => {
    if (key === null) return;
    let alive = true;
    latest.current().then(
      (value) => {
        if (alive) setLoaded({ resource, value: { status: 'ready', value } });
      },
      (error: unknown) => {
        if (alive) setLoaded({ resource, value: { status: 'error', message: describeFailure(error) } });
      }
    );
    return () => {
      alive = false;
    };
  }, [key]);
  if (loaded.resource === resource) return loaded.value;
  return resource === null ? IDLE : LOADING;
}

export function useTaskDiff(taskId: string, revision: number) {
  return useLoaded(taskId, revision, () =>
    remember(diffs, `${taskId}:${revision}`, () =>
      requestJson<TaskDiff>(`/api/tasks/${taskId}/diff?r=${revision}`)
    )
  );
}

export function useFileContent(taskId: string, path: string | null, revision: number) {
  const resource = path === null ? null : `${taskId}:${path}`;
  return useLoaded(resource, revision, () =>
    remember(files, `${resource}:${revision}`, async () => {
      const body = await requestJson<{ content: string | null }>(
        `/api/tasks/${taskId}/file?path=${encodeURIComponent(path ?? '')}&r=${revision}`
      );
      return body.content;
    })
  );
}
