import { Option, Schema } from 'effect';
import { TrayQueue } from './schema.ts';

const decodeQueue = Schema.decodeUnknownOption(TrayQueue);

const decodeQueueText = Schema.decodeUnknownOption(Schema.fromJsonString(TrayQueue));

export function parseTrayQueue(value: unknown): TrayQueue | null {
  return Option.getOrNull(decodeQueue(value));
}

export function parseTrayQueueText(text: string): TrayQueue | null {
  return Option.getOrNull(decodeQueueText(text));
}
