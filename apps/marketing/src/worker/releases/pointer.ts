import { Option, Schema } from 'effect';
import { DownloadPointer } from './schema.ts';

const decodePointer = Schema.decodeUnknownOption(DownloadPointer);

export function parseDownloadPointer(value: unknown): DownloadPointer | null {
  return Option.getOrNull(decodePointer(value));
}
