import { SCHEDULE_LIMITS } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { WATCH_TEXT_LIMIT, WatchAnswer, type WatchWording } from './schema.ts';

const decodeAnswer = Schema.decodeUnknownOption(WatchAnswer);

function readLine(value: string | undefined, max: number) {
  const line = value?.trim().split('\n', 1)[0]?.trim() ?? '';
  return line.length > 0 && line.length <= max ? line : null;
}

export function parseWatchAnswer(answer: unknown): WatchWording {
  const decoded = Option.getOrElse(decodeAnswer(answer), (): typeof WatchAnswer.Type => ({}));
  return {
    name: readLine(decoded.name, SCHEDULE_LIMITS.name),
    text: readLine(decoded.text, WATCH_TEXT_LIMIT),
  };
}
