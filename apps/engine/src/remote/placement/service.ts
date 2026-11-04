import {
  DomainError,
  PLACEMENT_SCHEMA,
  PLACEMENT_SYSTEM,
  type PlacementAnswer,
  type PlacementQuestion,
  parsePlacementAnswer,
  serializePlacementPrompt,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { QuickCalls } from '../../agents/quick/service.ts';
import { NoMachineAnswer } from './schema.ts';

export class PlacementAsker extends Context.Service<
  PlacementAsker,
  {
    place(question: PlacementQuestion): Effect.Effect<PlacementAnswer | null, DomainError>;
  }
>()('shinsa/engine/remote/placement/PlacementAsker') {
  static readonly layer = Layer.effect(
    PlacementAsker,
    Effect.gen(function* () {
      const quick = yield* QuickCalls;
      const decodeNoMachine = Schema.decodeUnknownOption(NoMachineAnswer);

      const place = Effect.fn('PlacementAsker.place')(function* (question: PlacementQuestion) {
        const said = yield* quick.classify<unknown>(
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

      return PlacementAsker.of({ place });
    })
  );
}
