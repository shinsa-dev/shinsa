import { parseEnrollFragment, REMOTE_PATHS } from '@shinsa/core';

export const MACHINES_PATH = '/machines';

export const SERVICE_WORKER_PATH = '/sw.js';

const INSTANCE_KEY = 'shinsa.remote.instance';

const ENROLL_KEY = 'shinsa.remote.enroll';

export type RemoteView =
  | { kind: 'machines' }
  | { kind: 'pair'; claimCode: string | null }
  | { kind: 'enroll' }
  | { kind: 'instance'; instanceId: string };

export function isRemoteBuild(env: Record<string, unknown> = import.meta.env) {
  return env.VITE_SHINSA_REMOTE === '1';
}

export function selectChosenInstance(storage: Storage) {
  return storage.getItem(INSTANCE_KEY);
}

export function writeChosenInstance(storage: Storage, instanceId: string | null) {
  if (instanceId) storage.setItem(INSTANCE_KEY, instanceId);
  else storage.removeItem(INSTANCE_KEY);
}

export function resolveRemoteView(
  location: Pick<Location, 'pathname' | 'search'>,
  storage: Storage
): RemoteView {
  if (location.pathname === REMOTE_PATHS.pairPage)
    return { kind: 'pair', claimCode: new URLSearchParams(location.search).get('code') };
  if (location.pathname === REMOTE_PATHS.enrollPage) return { kind: 'enroll' };
  if (location.pathname === MACHINES_PATH) return { kind: 'machines' };
  const instanceId = selectChosenInstance(storage);
  return instanceId ? { kind: 'instance', instanceId } : { kind: 'machines' };
}

export function stashEnrollFragment(storage: Storage, hash: string) {
  if (parseEnrollFragment(hash)) storage.setItem(ENROLL_KEY, hash.replace(/^#/, ''));
}

export function selectEnrollFragment(storage: Storage, hash: string) {
  return parseEnrollFragment(hash) ?? parseEnrollFragment(storage.getItem(ENROLL_KEY) ?? '');
}

export function clearEnrollFragment(storage: Storage) {
  storage.removeItem(ENROLL_KEY);
}
