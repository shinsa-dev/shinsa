import type { ChatAttachment } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ImageStrip } from '@/components/chat/image-strip.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { describeAttachment, splitAttachments } from '@/lib/chat/attachments.ts';

const CLAMP_LINES = 12;

const CLAMP_CHARACTERS = CLAMP_LINES * 90;

function FileChip({ attachment }: { attachment: ChatAttachment }) {
  const meta = describeAttachment(attachment);
  return (
    <div className={cn(CARD, 'flex h-10 min-w-0 max-w-64 items-center gap-2 p-1 pr-3')}>
      <span className='corner-superellipse/1.125 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-fg-2'>
        <Icon name={attachment.kind === 'image' ? 'IconImages1' : 'IconFileText'} className='size-4' />
      </span>
      <span className='flex min-w-0 flex-col gap-px'>
        <Truncate className='text-fg-4 text-xs'>{attachment.name}</Truncate>
        {meta && <Truncate className='text-2xs text-fg-2'>{meta}</Truncate>}
      </span>
    </div>
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

export function UserMessage({ text, attachments = [] }: { text: string; attachments?: ChatAttachment[] }) {
  const [expanded, setExpanded] = React.useState(false);
  const body = text.trim();
  if (!body && attachments.length === 0) return null;
  const long = body.split('\n').length > CLAMP_LINES || body.length > CLAMP_CHARACTERS;
  return (
    <div data-message className='flex min-w-0 flex-col items-end gap-2'>
      <Attachments attachments={attachments} />
      {body && (
        <div className='corner-superellipse/1.125 min-w-0 max-w-4/5 rounded-3xl border border-border bg-muted px-3.5 py-1.5 text-fg-4 text-xs leading-relaxed'>
          <p className={cn('whitespace-pre-wrap break-words', long && !expanded && 'line-clamp-12')}>
            {body}
          </p>
        </div>
      )}
      {long && (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className='cursor-pointer px-1 text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
