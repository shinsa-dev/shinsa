import { describe, expect, test } from 'bun:test';
import { lowerFirst } from '@shinsa/core';
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

  test('a long subject is cut at a word, or kept whole without a limit', () => {
    const title = 'Let the export also write CSV files and remember the last folder you chose for them';
    expect(serializeConventionalSubject('feat', title)).toBe(
      'feat: let the export also write CSV files and remember the last folder'
    );
    expect(serializeConventionalSubject('feat', title, null)).toBe(`feat: ${lowerFirst(title)}`);
  });

  test('a title that is already conventional never repeats its prefix', () => {
    expect(serializeConventionalSubject('feat', 'feat: add search')).toBe('feat: add search');
    expect(serializeConventionalSubject('feat', 'Fix(web)!: drop the old export')).toBe(
      'feat: drop the old export'
    );
    expect(serializeConventionalSubject('docs', 'Note: setup needs gh')).toBe('docs: note: setup needs gh');
  });

  test('a branch is a known type, a slash and a kebab slug', () => {
    expect(BRANCH_PATTERN.test('refactor/split-engine')).toBe(true);
    expect(BRANCH_PATTERN.test('shinsa/task')).toBe(false);
    expect(BRANCH_PATTERN.test('fix/Login')).toBe(false);
  });
});
