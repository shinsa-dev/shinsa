import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { APP_IDENTITY, resolveEngineLabel } from '@shinsa/core';

export const APP_BUNDLE_ID = process.env.SHINSA_APP_ID || APP_IDENTITY.appId;

export function resolveHomeLink() {
  return `${APP_IDENTITY.scheme}://home`;
}

export function resolveTaskLink(reference: string) {
  return `${APP_IDENTITY.scheme}://task/${encodeURIComponent(reference)}`;
}

export function resolveLinkPage(link: string) {
  const task = /^[a-z-]+:\/\/task\/(.+)$/.exec(link);
  return task?.[1] ? `/tasks/${task[1]}` : '/';
}

export function isPathArgument(arg: string) {
  return arg === '.' || arg === '..' || /^(\/|\.\.?\/|~(\/|$))/.test(arg);
}

export function resolvePathArgument(arg: string, cwd: string, home = homedir()) {
  if (arg === '~') return home;
  return resolve(cwd, arg.startsWith('~/') ? `${home}${arg.slice(1)}` : arg);
}

export function resolveEngineTarget(uid: number, appId = APP_BUNDLE_ID) {
  return `gui/${uid}/${resolveEngineLabel(appId)}`;
}

export interface EngineJob {
  program: string | null;
  relative: string | null;
  bundleId: string | null;
}

export function parseEngineJob(printed: string): EngineJob {
  const read = (pattern: RegExp) => pattern.exec(printed)?.[1]?.trim() || null;
  return {
    program: read(/^\s*program = (.+)$/m),
    relative: read(/^\s*program identifier = (.+?)(?: \(mode: \d+\))?$/m),
    bundleId: read(/^\s*parent bundle identifier = (.+)$/m),
  };
}

export interface ProgramIdentity {
  program: string;
  real: (path: string) => string;
  readBundleId: (app: string) => string | null;
}

export function isJobProgram(job: EngineJob, identity: ProgramIdentity) {
  if (job.program) return identity.real(job.program) === identity.program;
  if (!job.relative || !job.bundleId) return false;
  const suffix = `/${job.relative}`;
  if (!identity.program.endsWith(suffix)) return false;
  return identity.readBundleId(identity.program.slice(0, -suffix.length)) === job.bundleId;
}

export function resolveRealPath(path: string) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function readAppBundleId(app: string, plutil = '/usr/bin/plutil') {
  const plist = `${app}/Contents/Info.plist`;
  if (!existsSync(plist) || !existsSync(plutil)) return null;
  const result = Bun.spawnSync([plutil, '-extract', 'CFBundleIdentifier', 'raw', plist]);
  return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
}

export function ownsEngineJob(printed: string, program = process.execPath) {
  return isJobProgram(parseEngineJob(printed), {
    program: resolveRealPath(program),
    real: resolveRealPath,
    readBundleId: readAppBundleId,
  });
}
