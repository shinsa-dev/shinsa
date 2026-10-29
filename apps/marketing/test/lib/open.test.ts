import { describe, expect, test } from 'bun:test';
import { resolveTaskInvite } from '../../src/lib/open';

describe('resolveTaskInvite', () => {
  test('turns the task in the query into a link the Mac app opens, with its handle and title', () => {
    expect(
      resolveTaskInvite('?task=01a1880f-a4df-73bb-b4bf-ecbc86bea168&handle=LOC-28&title=Fix+the++tabs%0A')
    ).toEqual({
      link: 'shinsa://task/01a1880f-a4df-73bb-b4bf-ecbc86bea168',
      handle: 'LOC-28',
      title: 'Fix the tabs',
    });
  });

  test('drops a handle that is not one and an empty title, and cuts a long title', () => {
    expect(resolveTaskInvite('?task=id-1&handle=<b>x</b>&title=%20')).toEqual({
      link: 'shinsa://task/id-1',
      handle: null,
      title: null,
    });
    expect(resolveTaskInvite(`?task=id-1&title=${'t'.repeat(300)}`)?.title).toHaveLength(120);
  });

  test('refuses a missing, empty or unsafe task', () => {
    expect(resolveTaskInvite('')).toBeNull();
    expect(resolveTaskInvite('?task=')).toBeNull();
    expect(resolveTaskInvite('?task=../settings')).toBeNull();
    expect(resolveTaskInvite('?task=javascript:alert(1)')).toBeNull();
    expect(resolveTaskInvite(`?task=${'a'.repeat(65)}`)).toBeNull();
  });
});
