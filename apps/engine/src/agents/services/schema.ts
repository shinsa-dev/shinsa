import type {
  DomainError,
  ServiceDefinition,
  ShinsaState,
  Task,
  TerminalInfo,
  TerminalsSnapshot,
} from '@shinsa/core';
import type { Effect } from 'effect';
import type { ServiceInput, ServiceRun } from '../../terminals/index.ts';
import type { ToolCallFailed } from '../tools/schema.ts';

export const SERVICE_OUTPUT_LINES = 60;

export const SERVICE_ACTIONS = ['start', 'stop', 'restart'] as const;

export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

export type ServiceToolName = 'list_services' | 'run_service' | 'add_service' | 'remove_service';

type ServiceToolFailure = ToolCallFailed | DomainError;

export interface TaskServiceRunner {
  readonly home: string;
  readonly dataDir: string;
  snapshot(): TerminalsSnapshot;
  startService(id: string, run: ServiceRun): TerminalInfo;
  stopService(id: string, taskId: string | null): Promise<void>;
  restartService(id: string, run: ServiceRun): Promise<TerminalInfo>;
  readServiceOutput(id: string, taskId: string | null, lines: number): Promise<string[]>;
  addService(projectId: string, input: ServiceInput): ServiceDefinition;
  removeServices(ids: string[]): void;
}

export interface ServiceRunner {
  readonly home: string;
  readonly dataDir: string;
  readonly snapshot: Effect.Effect<TerminalsSnapshot>;
  readonly startService: (id: string, run: ServiceRun) => Effect.Effect<TerminalInfo, ServiceToolFailure>;
  readonly stopService: (id: string, taskId: string | null) => Effect.Effect<void, ServiceToolFailure>;
  readonly restartService: (id: string, run: ServiceRun) => Effect.Effect<TerminalInfo, ServiceToolFailure>;
  readonly readServiceOutput: (
    id: string,
    taskId: string | null,
    lines: number
  ) => Effect.Effect<string[], ServiceToolFailure>;
  readonly addService: (
    projectId: string,
    input: ServiceInput
  ) => Effect.Effect<ServiceDefinition, ServiceToolFailure>;
  readonly removeServices: (ids: string[]) => Effect.Effect<void, ServiceToolFailure>;
}

export interface ServiceToolContext {
  readonly state: ShinsaState;
  readonly task: Task;
  readonly runner: ServiceRunner;
  readonly now: number;
}
