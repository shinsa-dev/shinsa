export interface ChecklistItem {
  key: string;
  title: string;
  detail: string | null;
  command: string | null;
  done: boolean;
}

export interface Checklist<Item extends ChecklistItem = ChecklistItem> {
  title: string;
  items: Item[];
}

export interface ChecklistProgress {
  done: number;
  total: number;
  complete: boolean;
}

export function resolveChecklistProgress(items: readonly Pick<ChecklistItem, 'done'>[]): ChecklistProgress {
  const done = items.filter((item) => item.done).length;
  return { done, total: items.length, complete: done === items.length };
}

export function listOpenChecklistItems<Item extends ChecklistItem>(items: readonly Item[]) {
  return items.filter((item) => !item.done);
}
