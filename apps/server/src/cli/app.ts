import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const APP_BUNDLE_ID = process.env.SHINSA_APP_ID || 'studio.overclock.shinsa';

const ENGINE_LABEL = `${APP_BUNDLE_ID}.engine`;

export const HOME_LINK = 'shinsa://home';

export function resolveTaskLink(reference: string) {
  return `shinsa://task/${encodeURIComponent(reference)}`;
}

export function resolveLinkPage(link: string) {
  const task = /^shinsa:\/\/task\/(.+)$/.exec(link);
  return task?.[1] ? `/tasks/${task[1]}` : '/';
}

export function isPathArgument(arg: string) {
  return arg === '.' || arg === '..' || /^(\/|\.\.?\/|~(\/|$))/.test(arg);
}

export function resolvePathArgument(arg: string, cwd: string, home = homedir()) {
  if (arg === '~') return home;
  return resolve(cwd, arg.startsWith('~/') ? `${home}${arg.slice(1)}` : arg);
}

export function resolveEngineTarget(uid: number) {
  return `gui/${uid}/${ENGINE_LABEL}`;
}
