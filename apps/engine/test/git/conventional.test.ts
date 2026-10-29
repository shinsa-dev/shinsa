import { describe, expect, test } from 'bun:test';
import {
  BRANCH_PATTERN,
  resolveCommitType,
  SUBJECT_LIMIT,
  serializeConventionalSubject,
} from '../../src/git/conventional.ts';

describe('conventional commit naming', () => {
  test('the commit type is the branch prefix when it is a known type, else feat', () => {
    expect(resolveCommitType('docs/readme')).toBe('docs');
    expect(resolveCommitType('feature/login')).toBe('feat');
    expect(resolveCommitType('login')).toBe('feat');
    expect(resolveCommitType(null)).toBe('feat');
  });

  test('a subject starts lower case, never repeats its type and stays within the limit', () => {
    expect(serializeConventionalSubject('feat', ' Add search ')).toBe('feat: add search');
    expect(serializeConventionalSubject('fix', 'Fixes the tab scroll')).toBe('fix: the tab scroll');
    expect(serializeConventionalSubject('chore', 'x'.repeat(100))).toHaveLength(SUBJECT_LIMIT);
  });

  test('a branch is a known type, a slash and a kebab slug', () => {
    expect(BRANCH_PATTERN.test('refactor/split-engine')).toBe(true);
    expect(BRANCH_PATTERN.test('shinsa/task')).toBe(false);
    expect(BRANCH_PATTERN.test('fix/Login')).toBe(false);
  });
});
