import { lowerFirst } from '@shinsa/core';

export const COMMIT_TYPES = ['feat', 'fix', 'chore', 'refactor', 'docs', 'perf', 'test'] as const;

export type CommitType = (typeof COMMIT_TYPES)[number];

const DEFAULT_COMMIT_TYPE: CommitType = 'feat';

export const SUBJECT_LIMIT = 72;

export const BRANCH_PATTERN = new RegExp(`^(${COMMIT_TYPES.join('|')})\\/[a-z0-9-]+$`);

const WRITTEN_PREFIX = new RegExp(
  `^(${[...COMMIT_TYPES, 'build', 'ci', 'style', 'revert'].join('|')})(\\([^)]*\\))?!?:\\s*`,
  'i'
);

function isCommitType(text: string): text is CommitType {
  return (COMMIT_TYPES as readonly string[]).includes(text);
}

export function resolveCommitType(branch: string | null): CommitType {
  const prefix = branch?.split('/')[0] ?? '';
  return isCommitType(prefix) ? prefix : DEFAULT_COMMIT_TYPE;
}

function truncateAtWord(text: string, limit: number, start: number) {
  if (text.length <= limit) return text;
  const space = text.slice(0, limit + 1).lastIndexOf(' ');
  return (space > start ? text.slice(0, space) : text.slice(0, limit)).trimEnd();
}

export function serializeConventionalSubject(
  type: CommitType,
  text: string,
  limit: number | null = SUBJECT_LIMIT
) {
  const written = text.trim().replace(WRITTEN_PREFIX, '');
  const prefix = `${type}: `;
  const subject = `${prefix}${lowerFirst(written).replace(new RegExp(`^${type}(es)?\\s+`), '')}`;
  return limit === null ? subject : truncateAtWord(subject, limit, prefix.length);
}
