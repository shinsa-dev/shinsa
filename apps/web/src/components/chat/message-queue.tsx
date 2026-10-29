import { resolveCurrentRound, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { Textarea } from '@shinsa/ui/components/textarea';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD } from '@/components/layout/surface/card.ts';
import { Hint } from '@/components/overlays/hint.tsx';
import { isSubmitKey } from '@/lib/keys.ts';
import {
  describeQueue,
  listQueuedMessages,
  type QueuedMessage,
  removeQueuedMessage,
  sendQueuedMessage,
  updateQueuedMessage,
} from '@/lib/tasks/message-queue.ts';

function QueuedEditor({
  message,
  onSave,
  onCancel,
}: {
  message: QueuedMessage;
  onSave: (text: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [text, setText] = React.useState(message.text);
  const [busy, setBusy] = React.useState(false);
  const ready = text.trim().length > 0 && !busy;

  async function save() {
    if (!ready) return;
    setBusy(true);
    const saved = await onSave(text.trim());
    setBusy(false);
    if (saved) onCancel();
  }

  return (
    <li className='flex flex-col gap-1.5 p-1.5'>
      <Textarea
        autoFocus
        value={text}
        aria-label='Edit the queued message'
        onChange={(event) => setText(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (!isSubmitKey(event)) return;
          event.preventDefault();
          void save();
        }}
        className='max-h-40 min-h-10 resize-none'
      />
      <div className='flex justify-end gap-1.5'>
        <Button size='sm' variant='secondary' onClick={onCancel}>
          Cancel
        </Button>
        <Button size='sm' variant='primary' disabled={!ready} loading={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </li>
  );
}

function QueuedRow({
  message,
  current,
  onEdit,
  onSend,
  onRemove,
}: {
  message: QueuedMessage;
  current: number;
  onEdit: () => void;
  onSend: () => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [busy, setBusy] = React.useState(false);
  const act = (action: () => Promise<boolean>) => {
    setBusy(true);
    void action().then(() => setBusy(false));
  };
  return (
    <li
      data-queued-message
      className={cn('flex min-w-0 items-start gap-2 py-1.5 ps-3 pe-1.5', busy && 'opacity-60')}
    >
      <p className='selectable line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap break-words py-px text-fg-3 text-xs leading-relaxed'>
        {message.text}
      </p>
      <span className='flex shrink-0 gap-px'>
        <Hint label='Send now' detail={`It goes to round ${current} now, as a message.`}>
          <Button
            size='icon-xs'
            variant='secondary'
            aria-label='Send now'
            disabled={busy}
            onClick={() => act(onSend)}
          >
            <Icon name='IconArrowUp' />
          </Button>
        </Hint>
        <Button size='icon-xs' variant='secondary' aria-label='Edit message' disabled={busy} onClick={onEdit}>
          <Icon name='IconPencil' />
        </Button>
        <Button
          size='icon-xs'
          variant='secondary'
          aria-label='Remove from the queue'
          disabled={busy}
          onClick={() => act(onRemove)}
        >
          <Icon name='IconCrossSmall' />
        </Button>
      </span>
    </li>
  );
}

export function MessageQueue({
  state,
  task,
  onUpdate = (message, text) => updateQueuedMessage(task, message, text),
  onSend = (message) => sendQueuedMessage(task, message),
  onRemove = (message) => removeQueuedMessage(task, message),
}: {
  state: ShinsaState;
  task: Task;
  onUpdate?: (message: QueuedMessage, text: string) => Promise<boolean>;
  onSend?: (message: QueuedMessage) => Promise<boolean>;
  onRemove?: (message: QueuedMessage) => Promise<boolean>;
}) {
  const [editing, setEditing] = React.useState<number | null>(null);
  const messages = listQueuedMessages(task);
  if (messages.length === 0) return null;
  return (
    <section aria-label='Queued messages' className={cn(CARD, 'mb-1.5 flex flex-col')}>
      <header className='flex h-8 min-w-0 items-center gap-1.25 px-3 text-2xs'>
        <span className='flex shrink-0 items-center gap-1.25 text-fg-3'>
          <Icon size='sm' name='IconHourglass' />
          Queued
        </span>
        <span className='truncate text-fg-2'>· {describeQueue(state, task)}</span>
      </header>
      <ScrollArea className='border-border border-t' viewportClassName='max-h-44'>
        <ul className='flex flex-col divide-y divide-border'>
          {messages.map((message) =>
            message.number === editing ? (
              <QueuedEditor
                key={message.number}
                message={message}
                onSave={(text) => onUpdate(message, text)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <QueuedRow
                key={message.number}
                message={message}
                current={resolveCurrentRound(task).number}
                onEdit={() => setEditing(message.number)}
                onSend={() => onSend(message)}
                onRemove={() => onRemove(message)}
              />
            )
          )}
        </ul>
      </ScrollArea>
    </section>
  );
}
