#!/usr/bin/env bun
import { BunRuntime } from '@effect/platform-bun';
import { Effect } from 'effect';
import { executeCli } from './cli/index.ts';
import { CliLayer } from './cli/layers.ts';

BunRuntime.runMain(
  executeCli(Bun.argv.slice(2)).pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      })
    ),
    Effect.provide(CliLayer)
  )
);
