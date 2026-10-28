import { type ChatAttachment, splitMessageAttachments } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { FileCard } from '@/components/chat/file-card.tsx';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { type SettlingPhase, useSettling } from '@/hooks/use-settling.ts';
import { canOpenAttachment, splitAttachments } from '@/lib/chat/attachments.ts';
import type { HumanMessage } from '@/lib/chat/timeline.ts';
import { type DisclosurePersistId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import { describeMessageStatus, isDelivering } from '@/lib/tasks/messages.ts';

const CLAMP_LINES = 12;

const CLAMP_CHARACTERS = CLAMP_LINES * 90;

function FileChip({ attachment }: { attachment: ChatAttachment }) {
  return (
    <FileCard
      name={attachment.name}
      mimeType={attachment.mimeType}
      size={attachment.size}
      href={canOpenAttachment(attachment) ? attachment.url : null}
    />
  );
}

function Attachments({ attachments }: { attachments: ChatAttachment[] }) {
  const { images, files } = splitAttachments(attachments);
  return (
    <>
      {images.length > 0 && (
        <ImageStrip
          images={images.map((attachment) => ({ src: attachment.url, caption: attachment.name }))}
          size='lg'
          className='max-w-4/5 justify-end'
        />
      )}
      {files.length > 0 && (
        <div className='flex max-w-4/5 flex-wrap justify-end gap-2'>
          {files.map((attachment, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: attachments are positional
            <FileChip key={`${attachment.url}-${index}`} attachment={attachment} />
          ))}
        </div>
      )}
    </>
  );
}

function MessageStatus(message: Pick<HumanMessage, 'status' | 'reason'>) {
  const line = describeMessageStatus(message);
  if (!line) return null;
  return (
    <span
      className={cn(
        'max-w-4/5 px-1 text-right text-2xs',
        line.tone === 'refused' ? 'text-red-text' : 'text-fg-2'
      )}
    >
      {line.text}
    </span>
  );
}

const BUBBLE =
  'corner-superellipse/1.125 rounded-3xl border border-border bg-muted px-3.5 py-1.5 text-fg-4 text-xs leading-relaxed';

function DeliveryEdge({ phase }: { phase: SettlingPhase }) {
  if (!phase) return null;
  return (
    <span aria-hidden data-phase={phase} className='message-delivery corner-superellipse/1.125 rounded-3xl'>
      <span className='message-delivery-light' />
    </span>
  );
}

export function UserMessage({
  persistId,
  text,
  attachments = [],
  status,
  reason,
}: {
  persistId: DisclosurePersistId;
  text: string;
  attachments?: ChatAttachment[];
} & Pick<HumanMessage, 'status' | 'reason'>) {
  const { open: expanded, toggle } = useDisclosure(persistId, false);
  const delivery = useSettling(isDelivering({ status }));
  const split = splitMessageAttachments(text);
  const body = split.text;
  const shown = [...attachments, ...split.attachments];
  if (!body && shown.length === 0) return null;
  const long = body.split('\n').length > CLAMP_LINES || body.length > CLAMP_CHARACTERS;
  return (
    <div data-message data-delivery={delivery ?? undefined} className='flex min-w-0 flex-col items-end gap-2'>
      <Attachments attachments={shown} />
      {body && (
        <div className='relative min-w-0 max-w-4/5'>
          <div className={cn(BUBBLE, 'selectable')}>
            <p className={cn('whitespace-pre-wrap break-words', long && !expanded && 'line-clamp-12')}>
              {body}
            </p>
          </div>
          <DeliveryEdge phase={delivery} />
        </div>
      )}
      {long && (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={toggle}
          className='cursor-pointer px-1 text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {delivery === 'active' && <span className='sr-only'>Sending</span>}
      <MessageStatus status={status} reason={reason} />
    </div>
  );
}
