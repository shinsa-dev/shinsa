import type { Task } from '@shinsa/core';
import { Effect } from 'effect';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { listMessageComments } from '@/lib/review/draft.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { type MessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';

export function useTaskMessage(task: Task) {
  const draft = useReviewDraft();
  const comments = listMessageComments(draft);
  return {
    comments,
    send: (hint: MessageHint, text: string) =>
      runApp(
        Effect.promise(() => sendTaskMessage(task, hint, text, comments)).pipe(
          Effect.tap((sent) =>
            Effect.sync(() => {
              if (sent && comments.length > 0) draft.clearComments();
            })
          )
        )
      ),
  };
}
