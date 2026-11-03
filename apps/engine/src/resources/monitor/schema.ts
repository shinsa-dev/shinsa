import type { MachineResources, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Duration, Effect } from 'effect';
import { type Argv, type CommandResult, NOT_STARTED_EXIT_CODE } from '../../shell/schema.ts';
import type { CpuTimes, MemoryReading, ProcessRoot, ResourceListener } from '../schema.ts';

export class ResourceReadFailed extends Schema.TaggedError<
  ResourceReadFailed,
  { readonly brand: unique symbol }
>()('ResourceReadFailed', { message: Schema.String }) {}

type ResourceRun = (argv: Argv) => Effect.Effect<CommandResult, ResourceReadFailed>;

export interface ResourceMonitorDefinition {
  readonly dataDir: string;
  readonly roots: Effect.Effect<ProcessRoot[]>;
  readonly state: Effect.Effect<Pick<ShinsaState, 'tasks'>>;
  readonly run: ResourceRun | null;
  readonly readCpuTimes: Effect.Effect<CpuTimes>;
  readonly readMemory: Effect.Effect<MemoryReading | null, ResourceReadFailed> | null;
  readonly cores: number;
  readonly now: Effect.Effect<number>;
  readonly interval: Duration.Duration;
  readonly prime: Duration.Duration;
  readonly diskInterval: Duration.Duration;
}

export interface ResourceMonitorHandle {
  readonly snapshot: Effect.Effect<MachineResources | null>;
  readonly subscribe: (listener: ResourceListener) => Effect.Effect<Effect.Effect<void>>;
  readonly refresh: Effect.Effect<void>;
  readonly measureDisk: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

export const COMMAND_MISSING: CommandResult = {
  ok: false,
  code: NOT_STARTED_EXIT_CODE,
  stdout: '',
  stderr: '',
  timedOut: false,
};
