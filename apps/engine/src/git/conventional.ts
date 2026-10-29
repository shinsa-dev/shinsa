import { lowerFirst } from '@shinsa/core';

export const COMMIT_TYPES = ['feat', 'fix', 'chore', 'refactor', 'docs', 'perf', 'test'] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

const DEFAULT_COMMIT_TYPE: CommitType = 'feat';

export const SUBJECT_LIMIT = 72;

export const BRANCH_PATTERN = new RegExp(`^(${COMMIT_TYPES.join('|')})\\/[a-z0-9-]+$`);

function isCommitType(text: string): text is CommitType {
  return (COMMIT_TYPES as readonly string[]).includes(text);
}

export function resolveCommitType(branch: string | null): CommitType {
  const prefix = branch?.split('/')[0] ?? '';
  return isCommitType(prefix) ? prefix : DEFAULT_COMMIT_TYPE;
}

export function serializeConventionalSubject(type: CommitType, text: string) {
  const subject = lowerFirst(text.trim()).replace(new RegExp(`^${type}(es)?\\s+`), '');
  return `${type}: ${subject}`.slice(0, SUBJECT_LIMIT);
}
