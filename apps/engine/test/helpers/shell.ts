import { Effect, Layer } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';
import {
  runCommand as runShellCommand,
  runCommandOrThrow as runShellCommandOrThrow,
} from '../../src/shell/command.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import type { CommandOptions } from '../../src/shell/schema.ts';

const ShellTestLayer = Layer.merge(ShellLayer, JsonLogger);

export function runCommand(command: readonly string[], cwd: string, options: CommandOptions = {}) {
  return Effect.runPromise(runShellCommand(command, cwd, options).pipe(Effect.provide(ShellTestLayer)));
}

export function runCommandOrThrow(command: readonly string[], cwd: string, options: CommandOptions = {}) {
  return Effect.runPromise(
    runShellCommandOrThrow(command, cwd, options).pipe(Effect.provide(ShellTestLayer))
  );
}
