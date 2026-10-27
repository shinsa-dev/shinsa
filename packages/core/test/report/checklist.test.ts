import { describe, expect, test } from 'bun:test';
import {
  type ChecklistItem,
  listOpenChecklistItems,
  resolveChecklistProgress,
} from '../../src/report/index.ts';

function item(key: string, done: boolean): ChecklistItem {
  return { key, title: `Step ${key}`, detail: null, command: null, done };
}

describe('resolveChecklistProgress', () => {
  test('counts the ticked items against the whole list', () => {
    expect(resolveChecklistProgress([item('a', true), item('b', false), item('c', false)])).toEqual({
      done: 1,
      total: 3,
      complete: false,
    });
  });

  test('is complete once every item is ticked, and for an empty list', () => {
    expect(resolveChecklistProgress([item('a', true), item('b', true)])).toEqual({
      done: 2,
      total: 2,
      complete: true,
    });
    expect(resolveChecklistProgress([])).toEqual({ done: 0, total: 0, complete: true });
  });
});

describe('listOpenChecklistItems', () => {
  test('keeps the items left to do, in order, with their own fields', () => {
    const first = { ...item('a', false), round: 1 };
    const last = { ...item('c', false), round: 2 };
    expect(listOpenChecklistItems([first, { ...item('b', true), round: 1 }, last])).toEqual([first, last]);
  });
});
