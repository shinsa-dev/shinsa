import { describe, expect, it } from 'bun:test';
import {
  describeChecklistProgress,
  isTaskItemDone,
  isTaskList,
  isTaskListItem,
} from '@/lib/format/checklist.ts';

describe('describeChecklistProgress', () => {
  it('counts what is done until every item is', () => {
    expect(describeChecklistProgress([{ done: true }, { done: false }, { done: false }])).toBe('1 of 3 done');
    expect(describeChecklistProgress([{ done: true }, { done: true }])).toBe('All done');
  });
});

describe('Markdown task lists', () => {
  it('knows a task list and its items by the classes GFM gives them', () => {
    expect(isTaskList('contains-task-list')).toBe(true);
    expect(isTaskList(undefined)).toBe(false);
    expect(isTaskListItem('task-list-item')).toBe(true);
    expect(isTaskListItem('task-list-items')).toBe(false);
    expect(isTaskListItem(undefined)).toBe(false);
  });

  it('reads whether an item is ticked from its checkbox, in a tight or a loose list', () => {
    const box = (checked: boolean) => ({ type: 'element', tagName: 'input', properties: { checked } });
    const text = { type: 'text' };
    expect(isTaskItemDone({ type: 'element', tagName: 'li', children: [box(true), text] })).toBe(true);
    expect(isTaskItemDone({ type: 'element', tagName: 'li', children: [box(false), text] })).toBe(false);
    const loose = {
      type: 'element',
      tagName: 'li',
      children: [text, { type: 'element', tagName: 'p', children: [box(true), text] }],
    };
    expect(isTaskItemDone(loose)).toBe(true);
    expect(isTaskItemDone({ type: 'element', tagName: 'li', children: [text] })).toBe(false);
    expect(isTaskItemDone({ type: 'element', tagName: 'li' })).toBe(false);
    expect(isTaskItemDone(undefined)).toBe(false);
  });
});
