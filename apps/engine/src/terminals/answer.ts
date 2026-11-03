import { Option, Schema } from 'effect';
import { RefinedAnswer, RefinedEntry } from './schema.ts';

const decodeAnswer = Schema.decodeUnknownOption(RefinedAnswer);

const decodeEntry = Schema.decodeUnknownOption(RefinedEntry);

export function parseRefinedEntries(value: unknown): RefinedEntry[] | null {
  return Option.match(decodeAnswer(value), {
    onNone: () => null,
    onSome: (answer) => answer.services.flatMap((each) => Option.toArray(decodeEntry(each))),
  });
}
