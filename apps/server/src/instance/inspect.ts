import { DomainError } from '@shinsa/core';

export const INSPECT_READ_ONLY = 'inspect_read_only';

export const INSPECT_MESSAGE =
  'Shinsa is in inspect mode and only shows this data. Start it without SHINSA_INSPECT to change anything.';

export function createReadOnlyError(message = INSPECT_MESSAGE) {
  return new DomainError(INSPECT_READ_ONLY, message);
}
