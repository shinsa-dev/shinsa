import { homedir } from 'node:os';
import { Effect, Option } from 'effect';
import { selectOnPath } from '../../files/probe.ts';
import type { LocateDeps, ProgramLocation } from './versions/schema.ts';

export type { LocateDeps } from './versions/schema.ts';

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

export const whichOnPath = Effect.fn('ProgramVersions.whichOnPath')(function* (command: string) {
  return Option.getOrNull(yield* selectOnPath(command, Bun.env.PATH ?? ''));
});

export const locateProgram = Effect.fn('ProgramVersions.locateProgram')(function* (
  command: string,
  overrideEnv: string,
  deps: LocateDeps = {}
) {
  const value = (deps.env ?? Bun.env)[overrideEnv]?.trim();
  const override = value ? value.replace(/^~(?=\/|$)/, homedir()) : null;
  if (override) return { path: override, override } satisfies ProgramLocation;
  const path = deps.which ? deps.which(command) : yield* whichOnPath(command);
  return { path, override: null } satisfies ProgramLocation;
});
