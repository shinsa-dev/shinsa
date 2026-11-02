import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const PROJECT_ID_LIMIT = 200;

export const PATH_LIMIT = 4096;

export const PROJECT_GONE: FieldFailure = {
  code: 'project_not_found',
  message: 'That project is not there anymore.',
};
