import type { WorkspaceSupport } from '@shinsa/core';
import * as React from 'react';
import { requestJson } from '@/lib/connection/http.ts';
import { createSignal } from '@/lib/signal.ts';

export type WorkspaceSupportMap = Record<string, WorkspaceSupport>;

const signal = createSignal();

let support: WorkspaceSupportMap | null = null;

let pending: Promise<void> | null = null;

function publish(next: WorkspaceSupportMap) {
  support = next;
  signal.publish();
}

export function selectWorkspaceSupport() {
  return support;
}

export function resetWorkspaceSupport() {
  pending = null;
  support = null;
  signal.publish();
}

export function refreshWorkspaceSupport() {
  pending ??= requestJson<{ support: WorkspaceSupportMap }>('/api/repos/workspaces')
    .then(
      (answer) => publish(answer.support),
      () => publish({})
    )
    .then(() => {
      pending = null;
    });
  return pending;
}

export function useWorkspaceSupport(repoKey: string) {
  React.useEffect(() => {
    if (repoKey) void refreshWorkspaceSupport();
  }, [repoKey]);
  return React.useSyncExternalStore(signal.subscribe, selectWorkspaceSupport);
}
