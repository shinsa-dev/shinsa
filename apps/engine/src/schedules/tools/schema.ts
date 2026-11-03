import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { WebhookCredentials } from '../../secrets/schema.ts';

export class ScheduleToolRefused extends Schema.TaggedError<
  ScheduleToolRefused,
  { readonly brand: unique symbol }
>()('ScheduleToolRefused', { message: Schema.String }) {}

export class ScheduleSecretFailed extends Schema.TaggedError<
  ScheduleSecretFailed,
  { readonly brand: unique symbol }
>()('ScheduleSecretFailed', { message: Schema.String }) {}

type ScheduleToolFailure = DomainError | ScheduleToolRefused;

export interface ScheduleToolsDefinition {
  readonly now: Effect.Effect<number>;
  readonly timeZone: string;
  readonly baseUrl: Effect.Effect<string>;
  readonly hookUrl: (scheduleId: string, token: string) => Effect.Effect<string | null>;
  readonly selectHook: (scheduleId: string) => Effect.Effect<WebhookCredentials | null>;
  readonly hasRef: (ref: string) => Effect.Effect<boolean>;
  readonly takeSecret: (ref: string, taskId: string) => Effect.Effect<string, ScheduleSecretFailed>;
  readonly writeHookSecret: (scheduleId: string, secret: string) => Effect.Effect<void, ScheduleSecretFailed>;
}

export interface ScheduleToolRun {
  readonly runId: string;
  readonly attemptId: string;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand) => Effect.Effect<ShinsaEvent[], ScheduleToolFailure>;
}

export interface ScheduleToolsHandle {
  readonly findHookUrl: (scheduleId: string) => Effect.Effect<string, DomainError>;
  readonly assertSigningSecret: (
    scheduleId: string | null,
    ref: string | null,
    field: string
  ) => Effect.Effect<void, ScheduleToolRefused>;
  readonly writeScheduleSecret: (
    state: ShinsaState,
    scheduleId: string,
    ref: string | null,
    taskId: string
  ) => Effect.Effect<string | null>;
  readonly handle: (
    name: string,
    input: Record<string, unknown>,
    run: ScheduleToolRun
  ) => Effect.Effect<string, ScheduleToolFailure> | null;
}
