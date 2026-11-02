import type { FieldFailure } from '@shinsa/core/engine-api/schema';
import { Schema } from 'effect';

export const TASK_FILTERS = ['open', 'needs_you', 'settled', 'all'] as const;

export const TaskFilter = Schema.Literals(TASK_FILTERS);

export type TaskFilter = typeof TaskFilter.Type;

export const DEFAULT_FILTER: TaskFilter = 'open';

export const DEFAULT_LIMIT = 50;

export const MAX_LIMIT = 500;

export const ListLimit = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));

export const ChatIndex = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(-1));

export const CHAT_KINDS = ['user', 'agent', 'tool_call', 'tool_result', 'status', 'error', 'notice'] as const;

export const ChatKinds = Schema.Array(Schema.Literals(CHAT_KINDS));

export const DEFAULT_CHAT_KINDS = ['user', 'agent', 'error'] as const;

export const STATUS_FAILURE: FieldFailure = {
  code: 'status_invalid',
  message: 'status must be one of open, needs_you, settled, all.',
};

export const LIMIT_FAILURE: FieldFailure = {
  code: 'limit_invalid',
  message: 'limit must be a whole number of 1 or more.',
};

export const KINDS_FAILURE: FieldFailure = {
  code: 'kinds_invalid',
  message: 'kinds are user, agent, tool_call, tool_result, status, error, notice.',
};

export const AFTER_FAILURE: FieldFailure = { code: 'after_invalid', message: 'after must be an index.' };

export const WORKTREE_MISSING_MESSAGE = 'No worktree.';

export const CODE_TO_EDIT_MISSING = 'This task has no code to edit.';

export const PATH_LEAVES_WORKTREE = 'That path leaves the working copy.';

export const EDIT_SIZE_FAILURE: FieldFailure = {
  code: 'file_too_large',
  message: 'The editor saves files up to 2 MB.',
};
