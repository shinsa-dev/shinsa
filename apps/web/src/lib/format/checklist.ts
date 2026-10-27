import { type ChecklistItem, resolveChecklistProgress } from '@shinsa/core';

interface MarkdownNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

export function describeChecklistProgress(items: readonly Pick<ChecklistItem, 'done'>[]) {
  const progress = resolveChecklistProgress(items);
  return progress.complete ? 'All done' : `${progress.done} of ${progress.total} done`;
}

function hasClass(className: string | undefined, name: string) {
  return className?.split(' ').includes(name) ?? false;
}

export function isTaskList(className: string | undefined) {
  return hasClass(className, 'contains-task-list');
}

export function isTaskListItem(className: string | undefined) {
  return hasClass(className, 'task-list-item');
}

export function isTaskItemDone(node: MarkdownNode | undefined): boolean {
  for (const child of node?.children ?? []) {
    if (child.tagName === 'input') return child.properties?.checked === true;
    if (child.tagName === 'p') return isTaskItemDone(child);
  }
  return false;
}
