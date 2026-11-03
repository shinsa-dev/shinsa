import type { ShinsaState, Task } from '@shinsa/core';
import type * as React from 'react';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { useTaskMessage } from '@/hooks/use-task-message.ts';
import type { MessageHint } from '@/lib/tasks/messages.ts';

export function TaskComposer({
  state,
  task,
  hint,
  aside,
}: {
  state: ShinsaState;
  task: Task;
  hint: MessageHint;
  aside?: React.ReactNode;
}) {
  const message = useTaskMessage(task);
  return (
    <Composer
      draftKey={task.id}
      placeholder={hint.placeholder}
      submitLabel='Send message'
      onSubmit={(text) => message.send(hint, text)}
      aside={aside}
      comments={message.comments.length}
      dock={<MessageQueue state={state} task={task} />}
    />
  );
}
