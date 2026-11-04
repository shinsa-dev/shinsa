import type { Task } from '@shinsa/core';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { QuickCalls } from '../../agents/quick/service.ts';
import { describeSharePrompt } from './prompt.ts';
import { SHARE_DESCRIBE_SCHEMA, SHARE_DESCRIBE_SYSTEM, ShareDescriptionAnswer } from './schema.ts';

export class ShareDescriber extends Context.Service<
  ShareDescriber,
  {
    describe(task: Task): Effect.Effect<string | null>;
  }
>()('shinsa/engine/remote/share-describe/ShareDescriber') {
  static readonly layer = Layer.effect(
    ShareDescriber,
    Effect.gen(function* () {
      const quick = yield* QuickCalls;
      const decodeAnswer = Schema.decodeUnknownOption(ShareDescriptionAnswer);

      const describe = Effect.fn('ShareDescriber.describe')(function* (task: Task) {
        const answer = yield* quick.write<unknown>(
          SHARE_DESCRIBE_SYSTEM,
          describeSharePrompt(task),
          SHARE_DESCRIBE_SCHEMA
        );
        return Option.getOrNull(Option.map(decodeAnswer(answer), (decoded) => decoded.description));
      });

      return ShareDescriber.of({ describe });
    })
  );
}
