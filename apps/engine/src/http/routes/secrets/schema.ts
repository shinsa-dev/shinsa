import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const MAX_SECRET = 10_000;

export const SECRET_INVALID: FieldFailure = {
  code: 'secret_invalid',
  message: `Paste the secret: 1 to ${MAX_SECRET} characters.`,
};

export const NO_WEBHOOK: FieldFailure = {
  code: 'schedule_not_found',
  message: 'This schedule has no webhook.',
};

export const NO_SECRET_GATE: FieldFailure = {
  code: 'gate_not_found',
  message: 'No secret was asked for here.',
};

export const GATE_CLOSED: FieldFailure = { code: 'gate_closed', message: 'This has already been answered.' };
