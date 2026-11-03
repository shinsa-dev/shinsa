import type { ChatEvent, ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { Engine } from '../../runtime/engine.ts';
import { type ActiveRun } from '../active/schema.ts';
import { type Delivery } from '../delegations/schema.ts';
import type { Transcripts } from '../transcripts/index.ts';

export interface DeliveriesOptions {
  engine: Engine;
  transcripts: Transcripts;
  active: ReadonlyMap<string, ActiveRun>;
  execute: (runId: string, prompt: string, delivery: Delivery) => Promise<void>;
}

export class DeliveryFailed extends Schema.TaggedError<DeliveryFailed, { readonly brand: unique symbol }>()(
  'DeliveryFailed',
  { message: Schema.String }
) {}

export interface DeliveriesDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly active: ReadonlyMap<string, ActiveRun>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, DeliveryFailed>;
  readonly execute: (
    runId: string,
    prompt: string,
    delivery: Delivery
  ) => Effect.Effect<void, DeliveryFailed>;
  readonly record: (runId: string, entry: ChatEvent) => Effect.Effect<void>;
}

export interface DeliveriesHandle {
  readonly deliver: (runId: string, generation: number) => Effect.Effect<void, DeliveryFailed>;
  readonly wake: (runId: string, generation: number) => Effect.Effect<void, DeliveryFailed>;
  readonly steer: (
    runId: string,
    active: ActiveRun,
    delivery: Delivery
  ) => Effect.Effect<void, DeliveryFailed>;
  readonly confirmWake: (runId: string, active: ActiveRun) => Effect.Effect<void>;
  readonly release: (
    runId: string,
    active: ActiveRun,
    undelivered: string[]
  ) => Effect.Effect<string[], DeliveryFailed>;
}
