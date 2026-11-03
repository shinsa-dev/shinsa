import {
  DomainError,
  PLACEMENT_SCHEMA,
  PLACEMENT_SYSTEM,
  type PlacementQuestion,
  parsePlacementAnswer,
  serializePlacementPrompt,
} from '@shinsa/core';
import { Effect, Option, Schema } from 'effect';
import { NoMachineAnswer, type PlacementDefinition } from './schema.ts';

export const makePlacementAsker = (definition: PlacementDefinition) =>
  Effect.sync(() => {
    const decodeNoMachine = Schema.decodeUnknownOption(NoMachineAnswer);

    const place = Effect.fn('PlacementAsker.place')(function* (question: PlacementQuestion) {
      const said = yield* definition.ask(
        PLACEMENT_SYSTEM,
        serializePlacementPrompt(question),
        PLACEMENT_SCHEMA
      );
      if (said === null)
        return yield* new DomainError({
          code: 'placement_unavailable',
          message: 'Claude did not answer. Try again.',
        });
      if (Option.isSome(decodeNoMachine(said))) return null;
      const answer = parsePlacementAnswer(question, said);
      if (!answer)
        return yield* new DomainError({
          code: 'placement_unreadable',
          message: 'Claude named none of your machines.',
        });
      return answer;
    });

    return place;
  });
