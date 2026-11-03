import type { DomainError, ShinsaToolName, UserCommand } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { EngineAnswerInvalid, EngineCalls, EngineNotRunning } from '../cli/client/schema.ts';
import type { Display } from '../terminal/index.ts';
import type { FieldSpec, Values } from './fields.ts';

export class SurfaceCallFailed extends Schema.TaggedError<
  SurfaceCallFailed,
  { readonly brand: unique symbol }
>()('SurfaceCallFailed', { message: Schema.String }) {}

export type SurfaceFailure = DomainError | EngineNotRunning | EngineAnswerInvalid | SurfaceCallFailed;

export interface CommandReceipt {
  readonly ok: true;
  readonly taskId: string | null;
  readonly handle?: string | null | undefined;
  readonly scheduleId?: string;
}

export interface SurfaceHookSecrets {
  assertSecret: (scheduleId: string | null, ref: string | null) => void;
  writeSecret: (scheduleId: string, ref: string | null) => string | null;
}

interface SurfaceProjectChanges {
  upsertRepo: (projectId: string, path: string) => Effect.Effect<unknown, SurfaceFailure>;
  upsertFolder: (projectId: string, path: string) => Effect.Effect<unknown, SurfaceFailure>;
}

export interface SurfaceClient {
  base: string;
  api: EngineCalls;
  send: (command: UserCommand) => Effect.Effect<CommandReceipt, SurfaceFailure>;
  projects?: SurfaceProjectChanges;
  hookSecrets?: SurfaceHookSecrets;
}

export interface SurfaceResult {
  data: unknown;
  text: string;
}

type SurfaceAccess = 'read' | 'write';

type SurfaceRun = (
  client: SurfaceClient,
  values: Values,
  display?: Display
) => Effect.Effect<SurfaceResult, SurfaceFailure>;

export interface SurfaceSpec {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  access: SurfaceAccess;
  command?: UserCommand['type'];
  humanOnly?: boolean;
  agentTool?: ShinsaToolName;
  run: SurfaceRun;
}

export interface CommandDefinition {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  command: UserCommand['type'];
  humanOnly?: boolean;
  agentTool?: ShinsaToolName;
  build: (values: Values, client: SurfaceClient) => UserCommand | Effect.Effect<UserCommand, SurfaceFailure>;
  done?: (values: Values, receipt: CommandReceipt) => string;
  after?: (values: Values, receipt: CommandReceipt, client: SurfaceClient) => string | null;
}

export interface ReadDefinition<T> {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  humanOnly?: boolean;
  read: (values: Values, client: SurfaceClient) => Effect.Effect<T, SurfaceFailure>;
  format: (data: T, values: Values, display: Display) => string;
}

export interface ActionDefinition {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  humanOnly?: boolean;
  act: (
    client: SurfaceClient,
    values: Values,
    display: Display
  ) => Effect.Effect<SurfaceResult, SurfaceFailure>;
}
