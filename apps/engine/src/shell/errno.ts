import { Option, Schema } from 'effect';
import { SystemError } from './schema.ts';

const decodeSystemError = Schema.decodeUnknownOption(SystemError);

export function selectErrnoCode(error: unknown) {
  return Option.getOrNull(Option.map(decodeSystemError(error), ({ code }) => code));
}
