import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const PLACEMENT_INVALID: FieldFailure = {
  code: 'placement_invalid',
  message: 'Send the request and two or more machines with their policies, projects and load.',
};
