import { parseEnrollFragment, REMOTE_PATHS } from '@shinsa/core';

export const SERVICE_WORKER_PATH = `${REMOTE_PATHS.app}sw.js`;

export const SERVICE_WORKER_SCOPE = REMOTE_PATHS.app;

export const MACHINES_SECTION = 'Machines';

const ENROLL_KEY = 'shinsa.remote.enroll';

export type RemoteView = { kind: 'app' } | { kind: 'pair'; claimCode: string | null } | { kind: 'enroll' };

export function isRemoteBuild(env: Record<string, unknown> = import.meta.env) {
  return env.VITE_SHINSA_REMOTE === '1';
}

export function resolveRemoteView(location: Pick<Location, 'pathname' | 'search'>): RemoteView {
  if (location.pathname === REMOTE_PATHS.pairPage)
    return { kind: 'pair', claimCode: new URLSearchParams(location.search).get('code') };
  if (location.pathname === REMOTE_PATHS.enrollPage) return { kind: 'enroll' };
  return { kind: 'app' };
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
