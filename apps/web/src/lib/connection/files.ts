import type { TaskDiff } from '@shinsa/core';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';

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

function remember<T>(cache: Map<string, Promise<T>>, key: string, create: () => Promise<T>) {
  const known = cache.get(key);
  if (known) return known;
  const pending = create();
  cache.set(key, pending);
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
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
      requestJson<TaskDiff>(`/api/tasks/${encodeURIComponent(taskId)}/diff?r=${revision}`)
    )
  );
}

export function useFileContent(taskId: string, path: string | null, revision: number) {
  const resource = path === null ? null : `${taskId}:${path}`;
  return useLoaded(resource, revision, () =>
    remember(files, `${resource}:${revision}`, async () => {
      const body = await requestJson<{ content: string | null }>(
        `/api/tasks/${encodeURIComponent(taskId)}/file?path=${encodeURIComponent(path ?? '')}&r=${revision}`
      );
      return body.content;
    })
  );
}
