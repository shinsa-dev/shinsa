import type { DomainError, ShinsaCommand, ShinsaEvent, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';

export class ScheduleToolRefused extends Schema.TaggedError<
  ScheduleToolRefused,
  { readonly brand: unique symbol }
>()('ScheduleToolRefused', { message: Schema.String }) {}

export class ScheduleSecretFailed extends Schema.TaggedError<
  ScheduleSecretFailed,
  { readonly brand: unique symbol }
>()('ScheduleSecretFailed', { message: Schema.String }) {}

export type ScheduleToolFailure = DomainError | ScheduleToolRefused;

export interface ScheduleUrls {
  readonly baseUrl: Effect.Effect<string>;
  readonly hookUrl: (scheduleId: string, token: string) => Effect.Effect<string | null>;
}

export interface ScheduleToolRun {
  readonly runId: string;
  readonly attemptId: string;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (command: ShinsaCommand) => Effect.Effect<ShinsaEvent[], ScheduleToolFailure>;
}

export interface ScheduleToolsShape {
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
