import { isAbsolute, resolve } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { isFolder, selectRealPath } from '../files/probe.ts';
import { expandHome } from '../onboarding/roots.ts';

export const resolveProjectFolder = Effect.fn('Projects.resolveProjectFolder')(function* (
  raw: string,
  userHome: string
) {
  const text = raw.trim();
  const path = expandHome(text, userHome);
  if (!text || !isAbsolute(path)) {
    return yield* new DomainError({ code: 'folder_invalid', message: 'Give a full path, or one with ~/.' });
  }
  const real = yield* selectRealPath(resolve(path));
  if (Option.isNone(real) || !(yield* isFolder(real.value))) {
    return yield* new DomainError({
      code: 'folder_invalid',
      message: 'That is not a folder on this machine.',
    });
  }
  return real.value;
});
