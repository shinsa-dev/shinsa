#!/usr/bin/env bun
import { Effect } from 'effect';
import { executeCli } from './cli/index.ts';
import { edgeRuntime } from './runtime/edge.ts';

edgeRuntime.runFork(
  Effect.tap(executeCli(Bun.argv.slice(2)), (code) =>
    Effect.sync(() => {
      process.exitCode = code;
    })
  )
);
