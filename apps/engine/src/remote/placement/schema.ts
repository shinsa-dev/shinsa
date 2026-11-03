import { NO_PLACEMENT_MACHINE, type PlacementAnswer, type PlacementQuestion } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { JsonSchema } from '../../agents/providers/index.ts';

export type PlacementAsker = (question: PlacementQuestion) => Promise<PlacementAnswer | null>;

export class PlacementAskFailed extends Schema.TaggedError<
  PlacementAskFailed,
  { readonly brand: unique symbol }
>()('PlacementAskFailed', {
  message: Schema.String,
}) {}

export interface PlacementDefinition {
  readonly ask: (
    system: string,
    prompt: string,
    schema: JsonSchema
  ) => Effect.Effect<unknown, PlacementAskFailed>;
}

export const NoMachineAnswer = Schema.Struct({ machine: Schema.Literal(NO_PLACEMENT_MACHINE) });
