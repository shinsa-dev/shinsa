import { homedir } from 'node:os';
import { Effect } from 'effect';
import { edgeRuntime } from '../../runtime/edge.ts';
import type { LocateDeps, ProgramLocation, VersionParser } from './versions/schema.ts';
import { makeProgramVersions } from './versions/service.ts';

export type { LocateDeps, ProgramLocation } from './versions/schema.ts';

const programVersions = Effect.runSync(makeProgramVersions());

function splitVersion(version: string) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left: string, right: string) {
  const a = splitVersion(left);
  const b = splitVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function readProgramVersion(path: string, parse: VersionParser) {
  return edgeRuntime.runPromise(programVersions.read(path, parse));
}

export function whichOnPath(command: string) {
  return Bun.which(command, { PATH: Bun.env.PATH });
}

export function locateProgram(command: string, overrideEnv: string, deps: LocateDeps = {}): ProgramLocation {
  const value = (deps.env ?? Bun.env)[overrideEnv]?.trim();
  const override = value ? value.replace(/^~(?=\/|$)/, homedir()) : null;
  if (override) return { path: override, override };
  return { path: (deps.which ?? whichOnPath)(command), override: null };
}
