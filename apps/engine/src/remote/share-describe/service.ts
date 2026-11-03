import type { Task } from '@shinsa/core';
import { Effect, Option, Schema } from 'effect';
import { describeSharePrompt } from './prompt.ts';
import {
  SHARE_DESCRIBE_SCHEMA,
  SHARE_DESCRIBE_SYSTEM,
  type ShareDescribeDefinition,
  ShareDescriptionAnswer,
} from './schema.ts';

export const makeShareDescriber = (definition: ShareDescribeDefinition) =>
  Effect.sync(() => {
    const decodeAnswer = Schema.decodeUnknownOption(ShareDescriptionAnswer);

    return Effect.fn('ShareDescriber.describe')(function* (task: Task) {
      const answer = yield* definition.ask(
        SHARE_DESCRIBE_SYSTEM,
        describeSharePrompt(task),
        SHARE_DESCRIBE_SCHEMA
      );
      return Option.getOrNull(Option.map(decodeAnswer(answer), (decoded) => decoded.description));
    });
  });
