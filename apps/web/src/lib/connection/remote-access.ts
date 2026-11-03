import type { RemoteSnapshot } from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { connection } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';

interface RemoteAccessView {
  snapshot: RemoteSnapshot | null;
  failure: string | null;
}

const failureSignal = createSignal();

let failure: string | null = null;

let view: RemoteAccessView = { snapshot: null, failure: null };

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
  read.reset();
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

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    applyFirstRead(yield* engine.remote.snapshot());
  }).pipe(Effect.catch((error) => Effect.sync(() => replaceFailure(error.message))))
);

export function refreshRemoteAccess() {
  return read.run();
}

type RemoteEndpoints = EngineClient['Service']['remote'];

function act(call: (remote: RemoteEndpoints) => Effect.Effect<RemoteSnapshot, Error>) {
  return runApp(
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      const snapshot = yield* call(engine.remote);
      applyRemoteAccess(snapshot);
      return snapshot;
    })
  );
}

const NO_BODY = { payload: {} };

export const REMOTE_ACCESS_ACTIONS = {
  pair: () => act((remote) => remote.pair(NO_BODY)),
  cancelPairing: () => act((remote) => remote.cancelPairing(NO_BODY)),
  resume: () => act((remote) => remote.enable(NO_BODY)),
  pause: () => act((remote) => remote.disable(NO_BODY)),
  remove: () => act((remote) => remote.remove(NO_BODY)),
  revokeDevice: (publicKey: string) => act((remote) => remote.removeDevice({ payload: { publicKey } })),
  createLink: () => act((remote) => remote.createLink(NO_BODY)),
  removeLink: () => act((remote) => remote.removeLink(NO_BODY)),
  acceptRequest: (requestId: string) => act((remote) => remote.acceptRequest({ payload: { requestId } })),
  declineRequest: (requestId: string) => act((remote) => remote.declineRequest({ payload: { requestId } })),
  removeMember: (userId: string) => act((remote) => remote.removeMember({ payload: { userId } })),
};

export type RemoteAccessActions = typeof REMOTE_ACCESS_ACTIONS;

export function useRemoteAccess() {
  const current = React.useSyncExternalStore(subscribeRemoteAccess, selectRemoteAccess);
  React.useEffect(() => {
    void refreshRemoteAccess();
  }, []);
  return current;
}

function actOnMachine(
  machineId: string,
  call: (remote: RemoteEndpoints) => Effect.Effect<RemoteSnapshot, Error>
) {
  return runApp(
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      return yield* call(engine.remote);
    }).pipe(Effect.provide(EngineClient.onMachine(machineId)))
  );
}

export function acceptMachineRequest(machineId: string, requestId: string) {
  return actOnMachine(machineId, (remote) => remote.acceptRequest({ payload: { requestId } }));
}

export function declineMachineRequest(machineId: string, requestId: string) {
  return actOnMachine(machineId, (remote) => remote.declineRequest({ payload: { requestId } }));
}
