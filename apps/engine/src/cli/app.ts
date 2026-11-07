import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { APP_IDENTITY, resolveEngineLabel } from '@shinsa/core';
import { Effect, type FileSystem, Option } from 'effect';
import { isPresent, selectRealPath } from '../files/probe.ts';
import { runCommand } from '../shell/command.ts';
import type { Shell } from '../shell/service.ts';
import { PLUTIL, PLUTIL_TIMEOUT_MS } from './schema.ts';

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
  real: (path: string) => Effect.Effect<string>;
  readBundleId: (app: string) => Effect.Effect<string | null>;
}

export const isJobProgram = Effect.fn('Cli.isJobProgram')(function* (
  job: EngineJob,
  identity: ProgramIdentity
) {
  if (job.program) return (yield* identity.real(job.program)) === identity.program;
  if (!job.relative || !job.bundleId) return false;
  const suffix = `/${job.relative}`;
  if (!identity.program.endsWith(suffix)) return false;
  return (yield* identity.readBundleId(identity.program.slice(0, -suffix.length))) === job.bundleId;
});

export const resolveRealPath = Effect.fn('Cli.resolveRealPath')(function* (path: string) {
  return Option.getOrElse(yield* selectRealPath(path), () => path);
});

export const readAppBundleId = Effect.fn('Cli.readAppBundleId')(function* (app: string, plutil = PLUTIL) {
  const plist = `${app}/Contents/Info.plist`;
  if (!(yield* isPresent(plist)) || !(yield* isPresent(plutil))) return null;
  const result = yield* runCommand([plutil, '-extract', 'CFBundleIdentifier', 'raw', plist], app, {
    timeoutMs: PLUTIL_TIMEOUT_MS,
  });
  return result.ok ? result.stdout.trim() || null : null;
});

export const isInsideApp = Effect.fn('Cli.isInsideApp')(function* (program: string = process.execPath) {
  return (yield* resolveRealPath(program)).includes('.app/Contents/');
});

export const ownsEngineJob = Effect.fn('Cli.ownsEngineJob')(function* (
  printed: string,
  program: string = process.execPath
) {
  const context = yield* Effect.context<FileSystem.FileSystem | Shell>();
  const withContext = Effect.provide(context);
  return yield* isJobProgram(parseEngineJob(printed), {
    program: yield* resolveRealPath(program),
    real: (path) => withContext(resolveRealPath(path)),
    readBundleId: (app) => withContext(readAppBundleId(app)),
  });
});
