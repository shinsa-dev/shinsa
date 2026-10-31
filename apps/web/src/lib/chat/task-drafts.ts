import type { AttachmentDraft } from '@/lib/chat/attachment-drafts.ts';

export interface TaskDraft {
  text: string;
  attachments: AttachmentDraft[];
}

const EMPTY_DRAFT: TaskDraft = { text: '', attachments: [] };

const drafts = new Map<string, TaskDraft>();
const files = new Map<string, File>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeTaskDrafts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveTaskDraft(key: string) {
  return drafts.get(key) ?? EMPTY_DRAFT;
}

export function updateTaskDraft(key: string, change: (draft: TaskDraft) => Partial<TaskDraft>) {
  const current = resolveTaskDraft(key);
  drafts.set(key, { ...current, ...change(current) });
  notify();
}

export function clearTaskDraft(key: string) {
  for (const attachment of resolveTaskDraft(key).attachments) files.delete(attachment.key);
  drafts.delete(key);
  notify();
}

export function resetTaskDrafts() {
  drafts.clear();
  files.clear();
}

export const taskDraftFiles = files;
