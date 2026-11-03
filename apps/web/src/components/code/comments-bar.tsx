import type { Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import * as React from 'react';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useTaskMessage } from '@/hooks/use-task-message.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { describeCommentCount } from '@/lib/review/draft.ts';
import { resolveMessageHint } from '@/lib/tasks/messages.ts';

export function CommentsBar({ task }: { task: Task }) {
  const draft = useReviewDraft();
  const message = useTaskMessage(task);
  const hint = useShinsaSelector((state) => resolveMessageHint(state, task));
  const [busy, setBusy] = React.useState(false);
  if (draft.reviewing || !hint || message.comments.length === 0) return null;

  async function send() {
    if (!hint) return;
    setBusy(true);
    await message.send(hint, '');
    setBusy(false);
  }

  return (
    <section
      aria-label='Line comments'
      className='flex h-10 shrink-0 items-center gap-2 border-t border-border ps-3 pe-2 text-xs'
    >
      <Icon size='sm' name='IconBubbleText' className='text-fg-2' />
      <span className='min-w-0 flex-1 truncate text-fg-3'>
        {describeCommentCount(message.comments.length)}
      </span>
      <Button size='sm' loading={busy} onClick={() => void send()}>
        Send to the agent
      </Button>
    </section>
  );
}
