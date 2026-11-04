import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { ShellLayer } from '../apps/engine/src/shell/layers.ts';
import { reportFailure } from './kit/script.ts';
import { startSandbox } from './sandbox/index.ts';

startSandbox().pipe(
  Effect.andThen(Effect.never),
  reportFailure,
  Effect.scoped,
  Effect.provide(ShellLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
