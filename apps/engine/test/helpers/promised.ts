import { type Cause, Effect } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';

type ServiceEffect = Effect.Effect<unknown, Cause.YieldableError>;

type ServiceCall = (...args: never[]) => ServiceEffect;

type PromisedMember<M> =
  M extends Effect.Effect<infer A, infer _E, never>
    ? () => Promise<A>
    : M extends (...args: infer P) => Effect.Effect<infer A, infer _E, never>
      ? (...args: P) => Promise<A>
      : M extends object
        ? Promised<M>
        : M;

export type Promised<S> = { readonly [K in keyof S]: PromisedMember<S[K]> };

type Around = (effect: ServiceEffect) => ServiceEffect;

function isServiceEffect(value: unknown): value is ServiceEffect {
  return Effect.isEffect(value);
}

function isServiceCall(value: unknown): value is ServiceCall {
  return typeof value === 'function';
}

export function promised<S extends object>(service: S, around: Around = (effect) => effect): Promised<S> {
  const run = (effect: ServiceEffect) => Effect.runPromise(around(effect).pipe(Effect.provide(JsonLogger)));
  const entries = Object.entries(service).map(([key, member]: [string, unknown]) => {
    if (isServiceEffect(member)) return [key, () => run(member)];
    if (isServiceCall(member)) return [key, (...args: never[]) => run(member(...args))];
    if (member !== null && typeof member === 'object') return [key, promised(member, around)];
    return [key, member];
  });
  return Object.fromEntries(entries) as Promised<S>;
}
