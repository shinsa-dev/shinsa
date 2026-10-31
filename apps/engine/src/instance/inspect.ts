import { DomainError } from '@shinsa/core';

export const INSPECT_READ_ONLY = 'inspect_read_only';

export const INSPECT_MESSAGE = 'Inspect mode is read-only.';

export function createReadOnlyError(message = INSPECT_MESSAGE) {
  return new DomainError(INSPECT_READ_ONLY, message);
}
