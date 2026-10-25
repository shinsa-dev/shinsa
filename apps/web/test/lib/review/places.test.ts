import { describe, expect, it } from 'bun:test';
import { resolveCodePath, resolveReviewPath } from '@/lib/review/places.ts';
import { createTask } from '../../support/state.ts';

describe('review places', () => {
  it('opens a place in Code as a diff once the task has changes, with its spot', () => {
    const task = createTask({ id: 't1', handle: 'SW-1', stage: 'awaiting_review' });
    expect(resolveCodePath(task, { file: 'src/a.ts', start: 3, end: 5 }, '0:1')).toBe(
      '/tasks/SW-1?tab=code&mode=changes&file=src%2Fa.ts&diff=1&line=3&end=5&spot=0%3A1'
    );
    const planning = createTask({ id: 't2', handle: 'SW-2', stage: 'planning' });
    expect(resolveCodePath(planning, { file: 'a.ts', start: null, end: null })).toBe(
      '/tasks/SW-2?tab=code&mode=files&file=a.ts'
    );
  });

  it('opens the Review tab, at an item when given one', () => {
    const task = createTask({ id: 't1', handle: 'SW-1' });
    expect(resolveReviewPath(task)).toBe('/tasks/SW-1?tab=review');
    expect(resolveReviewPath(task, 'finding:0')).toBe('/tasks/SW-1?tab=review&spot=finding%3A0');
  });
});
