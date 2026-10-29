import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { ATTACHMENT_CORNER, ATTACHMENT_TILE_CORNER, CARD, INSET } from '@/components/layout/surface/card.ts';
import { describeAttachment, resolveFileGlyph } from '@/lib/chat/attachments.ts';

const FILE_CARD = cn(
  CARD,
  ATTACHMENT_CORNER,
  'group relative flex h-14 w-60 min-w-0 max-w-full items-center gap-3 p-1 pe-3'
);

function FileTile({ name, mimeType, busy }: { name: string; mimeType: string | null; busy: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        INSET,
        ATTACHMENT_TILE_CORNER,
        'file-icons-muted grid size-11.5 shrink-0 place-items-center bg-bg-a1 text-fg-3'
      )}
    >
      {busy ? <Spinner size='md' /> : <Icon size='lg' name={resolveFileGlyph({ name, mimeType })} />}
    </span>
  );
}

function FileLines({ name, meta }: { name: string; meta: string }) {
  return (
    <span className='flex min-w-0 flex-1 flex-col gap-px'>
      <Truncate className='text-fg-4 text-xs'>{name}</Truncate>
      {meta && <span className='truncate text-2xs text-fg-2 tabular-nums'>{meta}</span>}
    </span>
  );
}

export function FileCard({
  name,
  mimeType,
  size,
  href = null,
  busy = false,
  busyLabel,
  children,
}: {
  name: string;
  mimeType: string | null;
  size: number | null;
  href?: string | null;
  busy?: boolean;
  busyLabel?: string;
  children?: React.ReactNode;
}) {
  const meta = busy && busyLabel ? busyLabel : describeAttachment({ name, mimeType, size });
  const content = (
    <>
      <FileTile name={name} mimeType={mimeType} busy={busy} />
      <FileLines name={name} meta={meta} />
    </>
  );
  if (!href) {
    return (
      <div className={FILE_CARD}>
        {content}
        {children}
      </div>
    );
  }
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer'
      aria-label={`Open ${name}`}
      className={cn(FILE_CARD, 'cursor-pointer outline-none hover:bg-bg-a1 active:bg-bg-a1')}
    >
      {content}
      <Icon
        size='sm'
        name='IconArrowUpRight'
        className='shrink-0 text-fg-2 opacity-0 group-hover:opacity-100 group-active:opacity-100'
      />
    </a>
  );
}
