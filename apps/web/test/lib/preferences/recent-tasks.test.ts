import { describe, expect, it } from 'bun:test';
import { listRecentTaskIds, recordRecentTask } from '@/lib/preferences/recent-tasks.ts';

describe('recent tasks', () => {
  it('starts empty', () => {
    expect(listRecentTaskIds()).toEqual([]);
  });

  it('lists the most recent visit first without duplicates', () => {
    recordRecentTask('a');
    recordRecentTask('b');
    recordRecentTask('a');
    expect(listRecentTaskIds()).toEqual(['a', 'b']);
  });

  it('keeps the last eight', () => {
    for (const id of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) recordRecentTask(id);
    expect(listRecentTaskIds()).toEqual(['9', '8', '7', '6', '5', '4', '3', '2']);
  });

  it('ignores a stored value that is not a list of ids', () => {
    localStorage.setItem('shinsa.recent-tasks', '{"a":1}');
    expect(listRecentTaskIds()).toEqual([]);
    localStorage.setItem('shinsa.recent-tasks', 'not json');
    expect(listRecentTaskIds()).toEqual([]);
    localStorage.setItem('shinsa.recent-tasks', '["a",2,null,"b"]');
    expect(listRecentTaskIds()).toEqual(['a', 'b']);
  });
});
