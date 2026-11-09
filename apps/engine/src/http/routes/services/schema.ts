import type { FieldFailure } from '@shinsa/core/engine-api/schema';

export const TASK_ID_LIMIT = 200;

export const TASK_GONE: FieldFailure = { code: 'task_not_found', message: 'That task is not there anymore.' };

export const PLACE_GONE: FieldFailure = {
  code: 'terminal_place_missing',
  message: 'That folder is not there anymore.',
};

export const NO_MAIN_PLACE: FieldFailure = {
  code: 'service_place_invalid',
  message: 'Its folder is no longer in the project.',
};

export const NO_TASK_PLACE: FieldFailure = {
  code: 'service_place_invalid',
  message: 'It cannot run in this task.',
};
