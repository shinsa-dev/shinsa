import type { AttachmentDraft } from '@/lib/chat/attachment-drafts.ts';

export interface DraftCaret {
  start: number;
  end: number;
}

export interface TaskDraft {
  text: string;
  attachments: AttachmentDraft[];
  carriedCaret: DraftCaret | null;
  focusRequested: boolean;
}

const EMPTY_DRAFT: TaskDraft = { text: '', attachments: [], carriedCaret: null, focusRequested: false };

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

export function requestDraftReply(key: string, quote: string) {
  updateTaskDraft(key, (draft) => ({
    text: `> ${quote}\n\n${draft.text}`,
    focusRequested: true,
  }));
}

export function takeFocusRequest(key: string) {
  if (!resolveTaskDraft(key).focusRequested) return false;
  updateTaskDraft(key, () => ({ focusRequested: false }));
  return true;
}

export function carryDraftFocus(key: string, caret: DraftCaret) {
  updateTaskDraft(key, () => ({ carriedCaret: caret }));
}

export function takeCarriedCaret(key: string) {
  const caret = resolveTaskDraft(key).carriedCaret;
  removeCarriedCaret(key);
  return caret;
}

export function removeCarriedCaret(key: string) {
  if (resolveTaskDraft(key).carriedCaret) updateTaskDraft(key, () => ({ carriedCaret: null }));
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
