import type { RemoteEnrollment, RemoteSnapshot } from '@shinsa/core';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { isRemoteSettling, REMOTE_POLL_MS } from '@/lib/remote-access.ts';
import { createSignal } from '@/lib/signal.ts';

interface RemoteAccessView {
  snapshot: RemoteSnapshot | null;
  failure: string | null;
}

const signal = createSignal();

const EMPTY: RemoteAccessView = { snapshot: null, failure: null };

let view: RemoteAccessView = EMPTY;

let pending: Promise<void> | null = null;

function publish(next: RemoteAccessView) {
  view = next;
  signal.publish();
}

export function selectRemoteAccess() {
  return view;
}

export function resetRemoteAccess() {
  pending = null;
  publish(EMPTY);
}

export function refreshRemoteAccess() {
  pending ??= requestJson<RemoteSnapshot>('/api/remote')
    .then(
      (snapshot) => publish({ snapshot, failure: null }),
      (error: unknown) => publish({ ...view, failure: describeFailure(error) })
    )
    .then(() => {
      pending = null;
    });
  return pending;
}

async function act(path: string, body: unknown = {}) {
  const snapshot = await requestJson<RemoteSnapshot>(`/api/remote${path}`, body);
  publish({ snapshot, failure: null });
  return snapshot;
}

export const REMOTE_ACCESS_ACTIONS = {
  pair: () => act('/pair'),
  cancelPairing: () => act('/pair/cancel'),
  resume: () => act('/enable'),
  pause: () => act('/disable'),
  remove: () => act('/remove'),
  forgetDevice: (publicKey: string) => act('/devices/remove', { publicKey }),
  createEnrollment: (name: string) => requestJson<RemoteEnrollment>('/api/remote/devices/enroll', { name }),
};

export type RemoteAccessActions = typeof REMOTE_ACCESS_ACTIONS;

export function useRemoteAccess(active = true) {
  const current = React.useSyncExternalStore(signal.subscribe, selectRemoteAccess);
  const settling = isRemoteSettling(current.snapshot);
  React.useEffect(() => {
    if (!active) return;
    void refreshRemoteAccess();
    if (!settling) return;
    const timer = setInterval(() => void refreshRemoteAccess(), REMOTE_POLL_MS);
    return () => clearInterval(timer);
  }, [active, settling]);
  return current;
}
