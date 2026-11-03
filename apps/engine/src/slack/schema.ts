import type { MachineCredentials, ShinsaCommand, ShinsaEffect, ShinsaState, DomainError } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import type { SlackRelayCalls, Token } from '../remote/client/schema.ts';
import type { Remote } from '../remote/index.ts';
import type { Engine } from '../runtime/engine.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const STATUS_INTERVAL = Duration.seconds(5);

export const SlackBodyText = Schema.fromJsonString(Schema.Unknown);

export type SlackEffect<Kind extends ShinsaEffect['kind']> = Extract<ShinsaEffect, { kind: Kind }>;

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface SlackOptions {
  engine: Engine;
  remote: Remote;
  ask: QuickJson;
  now?: () => number;
  sleep?: Sleep;
  statusIntervalMs?: number;
}

export class SlackCommandFailed extends Schema.TaggedError<
  SlackCommandFailed,
  { readonly brand: unique symbol }
>()('SlackCommandFailed', { message: Schema.String }) {}

export class SlackAskFailed extends Schema.TaggedError<SlackAskFailed, { readonly brand: unique symbol }>()(
  'SlackAskFailed',
  { message: Schema.String }
) {}

export class SlackWaitStopped extends Schema.TaggedError<
  SlackWaitStopped,
  { readonly brand: unique symbol }
>()('SlackWaitStopped', { message: Schema.String }) {}

export class SlackRequestUnreadable extends Schema.TaggedError<
  SlackRequestUnreadable,
  { readonly brand: unique symbol }
>()('SlackRequestUnreadable', { message: Schema.String }) {}

export interface SlackDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    id: string
  ) => Effect.Effect<void, DomainError | SlackCommandFailed>;
  readonly credentials: Effect.Effect<MachineCredentials | null>;
  readonly appOrigin: Effect.Effect<string>;
  readonly relay: SlackRelayCalls;
  readonly token: (machineToken: string) => Token;
  readonly ask: (
    system: string,
    prompt: string,
    schema: JsonSchema
  ) => Effect.Effect<unknown, SlackAskFailed>;
  readonly now: Effect.Effect<number>;
  readonly sleep: ((ms: number, signal: AbortSignal) => Effect.Effect<void, SlackWaitStopped>) | null;
  readonly statusInterval: Duration.Duration;
}
