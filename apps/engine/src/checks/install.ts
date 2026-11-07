import { join } from 'node:path';
import { Effect, Option } from 'effect';
import { isPresent } from '../files/probe.ts';
import { PACKAGE_MANAGERS } from './schema.ts';

export const selectInstallCommand = Effect.fn('Checks.selectInstallCommand')(function* (path: string) {
  for (const manager of PACKAGE_MANAGERS) {
    const locked = yield* Effect.forEach(manager.lockfiles, (file) => isPresent(join(path, file)));
    if (locked.some(Boolean) && manager.install) return Option.some(manager.install);
  }
  return Option.none<string[]>();
});
