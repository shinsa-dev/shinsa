import type { Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { CodeLoading } from '@/components/code/code-loading.tsx';
import { claimPrefetch, prefetchTaskCode } from '@/lib/code/prefetch.ts';
import type { TaskTab } from '@/lib/tasks/tabs.ts';

const IDLE_TIMEOUT_MS = 2000;

type CodeModule = typeof import('./code.tsx');

let loaded: CodeModule | null = null;

async function requestCodeTab() {
  loaded = await import('./code.tsx');
  return loaded;
}

export function CodeTab(props: React.ComponentProps<CodeModule['CodeTab']>) {
  const [module, setModule] = React.useState<CodeModule | 'failed' | null>(loaded);
  React.useEffect(() => {
    if (module) return;
    requestCodeTab().then(setModule, () => setModule('failed'));
  }, [module]);
  if (module === 'failed') {
    return (
      <EmptyState
        size='sm'
        icon='IconFolder1'
        title='The code view did not load'
        description='Reload the page to try again.'
      />
    );
  }
  if (!module) {
    return <CodeLoading label='Opening the code…' />;
  }
  return <module.CodeTab {...props} />;
}

export async function prefetchCode(task: Task) {
  const release = claimPrefetch(task);
  if (!release) return;
  try {
    const [module, path] = await Promise.all([
      requestCodeTab(),
      prefetchTaskCode(task, window.location.search),
    ]);
    await module.prefetchCodeEditor(path);
  } catch {
    release();
  }
}

export function usePrefetchCode(task: Task | null, tabs: readonly TaskTab[], tab: TaskTab) {
  const hasCode = tabs.includes('code');
  const latest = React.useRef(task);
  latest.current = task;
  const taskId = task?.id ?? null;
  React.useEffect(() => {
    if (!hasCode || !taskId) return;
    const run = () => {
      if (latest.current) void prefetchCode(latest.current);
    };
    if (tab === 'code') {
      run();
      return;
    }
    if (typeof requestIdleCallback === 'function') {
      const handle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(handle);
    }
    const timer = setTimeout(run, IDLE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [hasCode, taskId, tab]);
}
