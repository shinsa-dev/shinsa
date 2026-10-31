import { parseEnrollFragment, REMOTE_PATHS } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';

export const SERVICE_WORKER_PATH = `${REMOTE_PATHS.app}sw.js`;

export const SERVICE_WORKER_SCOPE = REMOTE_PATHS.app;

export const MACHINES_SECTION = 'Machines';

export const MACHINE_ICON: IconName = 'IconMacbookRemote';

const ENROLL_KEY = 'shinsa.remote.enroll';

const ENROLL_ON_MACHINE_KEY = 'shinsa.remote.enroll.on-machine';

export const ON_MACHINE_PARAM = 'on';

export const ON_MACHINE_VALUE = 'machine';

export const THIS_MACHINE = 'This machine';

export function resolveMachineLabel(machine: { name: string; current?: boolean }) {
  return machine.current ? THIS_MACHINE : machine.name;
}

export function resolveOnMachineUrl(url: string) {
  const [address = url, fragment] = url.split('#');
  const marked = `${address}${address.includes('?') ? '&' : '?'}${ON_MACHINE_PARAM}=${ON_MACHINE_VALUE}`;
  return fragment === undefined ? marked : `${marked}#${fragment}`;
}

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

export function stashEnrollFragment(storage: Storage, hash: string, search = '') {
  if (!parseEnrollFragment(hash)) return;
  storage.setItem(ENROLL_KEY, hash.replace(/^#/, ''));
  if (new URLSearchParams(search).get(ON_MACHINE_PARAM) === ON_MACHINE_VALUE)
    storage.setItem(ENROLL_ON_MACHINE_KEY, ON_MACHINE_VALUE);
  else storage.removeItem(ENROLL_ON_MACHINE_KEY);
}

export function selectEnrollFragment(storage: Storage, hash: string) {
  const link = parseEnrollFragment(hash) ?? parseEnrollFragment(storage.getItem(ENROLL_KEY) ?? '');
  return link ? { ...link, onMachine: storage.getItem(ENROLL_ON_MACHINE_KEY) === ON_MACHINE_VALUE } : null;
}

export function clearEnrollFragment(storage: Storage) {
  storage.removeItem(ENROLL_KEY);
  storage.removeItem(ENROLL_ON_MACHINE_KEY);
}

export function describeUnreachableMachine(name: string) {
  return `Add this device on ${name} first`;
}
