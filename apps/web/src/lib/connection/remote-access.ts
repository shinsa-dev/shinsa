import type { RemoteEnrollment, RemoteSnapshot } from '@shinsa/core';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { connection } from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';

interface RemoteAccessView {
  snapshot: RemoteSnapshot | null;
  failure: string | null;
}

const failureSignal = createSignal();

let failure: string | null = null;

let view: RemoteAccessView = { snapshot: null, failure: null };

let pending: Promise<void> | null = null;

function replaceFailure(next: string | null) {
  failure = next;
  failureSignal.publish();
}

function subscribeRemoteAccess(listener: () => void) {
  const releaseRemote = connection.subscribeRemote(listener);
  const releaseFailure = failureSignal.subscribe(listener);
  return () => {
    releaseRemote();
    releaseFailure();
  };
}

export function selectRemoteAccess() {
  const snapshot = connection.selectRemote();
  if (view.snapshot !== snapshot || view.failure !== failure) view = { snapshot, failure };
  return view;
}

export function resetRemoteAccess() {
  pending = null;
  replaceFailure(null);
}

function applyRemoteAccess(snapshot: RemoteSnapshot) {
  failure = null;
  connection.replaceRemote(snapshot);
}

function applyFirstRead(snapshot: RemoteSnapshot) {
  if (connection.selectRemote() === null) applyRemoteAccess(snapshot);
  else replaceFailure(null);
}

export function refreshRemoteAccess() {
  pending ??= requestJson<RemoteSnapshot>('/api/remote')
    .then(applyFirstRead, (error: unknown) => replaceFailure(describeFailure(error)))
    .then(() => {
      pending = null;
    });
  return pending;
}

async function act(path: string, body: unknown = {}) {
  const snapshot = await requestJson<RemoteSnapshot>(`/api/remote${path}`, body);
  applyRemoteAccess(snapshot);
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

export function useRemoteAccess() {
  const current = React.useSyncExternalStore(subscribeRemoteAccess, selectRemoteAccess);
  React.useEffect(() => {
    void refreshRemoteAccess();
  }, []);
  return current;
}
