import { dirname, resolve } from 'node:path';
import { Effect, Option } from 'effect';
import { isInside } from './paths.ts';
import { isPresent, selectRealPath } from './probe.ts';

export const selectInside = Effect.fn('Files.selectInside')(function* (root: string, relative: string) {
  const base = yield* selectRealPath(root);
  if (Option.isNone(base)) return Option.none<string>();
  const target = resolve(base.value, relative);
  if (!isInside(base.value, target) || target === base.value) return Option.none<string>();
  const real = yield* selectRealPath(target);
  if (Option.isNone(real)) return Option.some(target);
  return isInside(base.value, real.value) ? Option.some(target) : Option.none<string>();
});

export const selectWritableInside = Effect.fn('Files.selectWritableInside')(function* (
  root: string,
  relative: string
) {
  const target = yield* selectInside(root, relative);
  if (Option.isNone(target)) return target;
  const base = yield* selectRealPath(root);
  let ancestor = dirname(target.value);
  while (!(yield* isPresent(ancestor))) ancestor = dirname(ancestor);
  const real = yield* selectRealPath(ancestor);
  const inside = Option.isSome(base) && Option.isSome(real) && isInside(base.value, real.value);
  return inside ? target : Option.none<string>();
});
