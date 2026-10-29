import { describe, expect, test } from 'bun:test';
import { resolveTaskLink } from '../../src/lib/open';

describe('resolveTaskLink', () => {
  test('turns the task in the query into a link the Mac app opens', () => {
    expect(resolveTaskLink('?task=01a1880f-a4df-73bb-b4bf-ecbc86bea168')).toBe(
      'shinsa://task/01a1880f-a4df-73bb-b4bf-ecbc86bea168'
    );
  });

  test('refuses a missing, empty or unsafe task', () => {
    expect(resolveTaskLink('')).toBeNull();
    expect(resolveTaskLink('?task=')).toBeNull();
    expect(resolveTaskLink('?task=../settings')).toBeNull();
    expect(resolveTaskLink('?task=javascript:alert(1)')).toBeNull();
    expect(resolveTaskLink(`?task=${'a'.repeat(65)}`)).toBeNull();
  });
});
