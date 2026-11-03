import type { Task } from '@shinsa/core';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { listMessageComments } from '@/lib/review/draft.ts';
import { type MessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';

export function useTaskMessage(task: Task) {
  const draft = useReviewDraft();
  const comments = listMessageComments(draft);
  return {
    comments,
    send: async (hint: MessageHint, text: string) => {
      const sent = await sendTaskMessage(task, hint, text, comments);
      if (sent && comments.length > 0) draft.clearComments();
      return sent;
    },
  };
}
