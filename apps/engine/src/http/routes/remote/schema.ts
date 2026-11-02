import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const DEVICE_NOT_FOUND: FieldFailure = {
  code: 'device_not_found',
  message: 'No device with that key is enrolled.',
};
