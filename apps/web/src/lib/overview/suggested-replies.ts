import type { ShinsaState, SuggestedAction, Task } from '@shinsa/core';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';

export function listSuggestedReplies(state: ShinsaState, task: Task): SuggestedAction[] {
  const actions = task.suggestedActions ?? [];
  if (actions.length === 0 || !resolveMessageHint(state, task)) return [];
  return actions;
}

export function sendSuggestedReply(state: ShinsaState, task: Task, action: SuggestedAction) {
  const hint = resolveMessageHint(state, task);
  if (!hint) return Promise.resolve(false);
  return sendTaskMessage(task, hint, action.message);
}
