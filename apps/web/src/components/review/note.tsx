import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { InsetNote, SuggestedFix } from '@/components/text/inset-note.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { NoteHead } from '@/components/text/note-head.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  type Disclosure,
  type DisclosurePersistId,
  extendDisclosureId,
  useDisclosure,
} from '@/lib/preferences/disclosure.ts';
import {
  describeItemPlace,
  isFindingItem,
  REVIEW_AUTHOR_ICON,
  type ReviewItem,
  resolveNoteHeading,
} from '@/lib/review/report.ts';

export const REVIEW_SELECTED =
  'outline-2 outline-offset-2 outline-transparent transition-[outline-color] duration-500 data-selected:outline-primary-a3';

function Alternatives({ item }: { item: ReviewItem }) {
  if (item.alternatives.length === 0) return null;
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-2xs text-fg-2'>Also considered</span>
      <ul className='flex flex-col gap-1'>
        {item.alternatives.map((alternative) => (
          <li key={alternative.option} className='flex min-w-0 gap-1.5 text-xs'>
            <Icon size='sm' name='IconSplit' className='mt-0.5' />
            <span className='selectable flex min-w-0 flex-1 flex-col gap-px'>
              <InlineMarkdown text={alternative.option} className='font-medium text-fg-4' />
              <InlineMarkdown text={alternative.rejected} className='text-fg-3' />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Why({ item }: { item: ReviewItem }) {
  if (!item.why) return null;
  return (
    <p className='flex min-w-0 flex-col gap-px text-xs'>
      <span className={cn('text-2xs', TONE_TEXT[item.tone])}>Why it matters</span>
      <InlineMarkdown text={item.why} className='selectable text-fg-3' />
    </p>
  );
}

function NotePlace({
  persistId,
  task,
  item,
  compact,
}: {
  persistId: DisclosurePersistId;
  task: Task | null;
  item: ReviewItem;
  compact: boolean;
}) {
  const place = item.place;
  if (!place || compact) return null;
  if (task?.repoId) {
    return (
      <ChangeSnippet
        persistId={extendDisclosureId(persistId, 'snippet')}
        task={task}
        path={place.file}
        start={place.start}
        end={place.end}
        spot={item.key}
        startsOpen
      />
    );
  }
  return (
    <span className='text-2xs'>
      <FileLink task={task} path={place.file} label={describeItemPlace(place)} />
    </span>
  );
}

function NoteLabel({ item }: { item: ReviewItem }) {
  return (
    <>
      <span className='shrink-0 text-fg-2'>{resolveNoteHeading(item).author}</span>
      <span className='shrink-0 text-fg-2'>·</span>
      <ToneLabel label={item.label} tone={item.tone} />
      {item.section && (
        <>
          <span className='shrink-0 text-fg-2'>·</span>
          <Truncate className='min-w-0 text-fg-2'>{item.section}</Truncate>
        </>
      )}
    </>
  );
}

function NoteBar({
  item,
  disclosure,
  action,
}: {
  item: ReviewItem;
  disclosure: Disclosure;
  action: React.ReactNode;
}) {
  const heading = resolveNoteHeading(item);
  return (
    <DisclosureHeader
      as='div'
      disclosure={disclosure}
      label={item.label.toLowerCase()}
      strip='band'
      chevron='box'
      action={action && <span className='flex shrink-0 items-center gap-1.5'>{action}</span>}
      className='flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 ps-3 text-xs'
    >
      <IconSlot>
        <Icon size='sm' name={REVIEW_AUTHOR_ICON[item.author]} />
      </IconSlot>
      {heading.author && <span className='shrink-0 font-medium text-fg-4'>{heading.author}</span>}
      {heading.title && <Truncate className='min-w-0 font-medium text-fg-4'>{heading.title}</Truncate>}
      <span className='shrink-0 text-fg-2'>·</span>
      <ToneLabel label={item.label} tone={item.tone} />
      {item.section && (
        <>
          <span className='shrink-0 text-fg-2'>·</span>
          <Truncate className='min-w-0 text-2xs text-fg-2'>{item.section}</Truncate>
        </>
      )}
    </DisclosureHeader>
  );
}

function NoteDetails({
  persistId,
  task,
  item,
  compact,
}: {
  persistId: DisclosurePersistId;
  task: Task | null;
  item: ReviewItem;
  compact: boolean;
}) {
  return (
    <>
      <Why item={item} />
      <Alternatives item={item} />
      {item.disagreement && (
        <InsetNote
          label='The agent review disagrees'
          icon='IconEyeSparkle'
          text={item.disagreement}
          tone='orange'
        />
      )}
      <NotePlace persistId={persistId} task={task} item={item} compact={compact} />
      {item.fix && <SuggestedFix text={item.fix} />}
    </>
  );
}

export function ReviewNote({
  persistId,
  item,
  task = null,
  selected = false,
  compact = false,
  action = null,
  className,
}: {
  persistId: DisclosurePersistId;
  item: ReviewItem;
  task?: Task | null;
  selected?: boolean;
  compact?: boolean;
  action?: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const disclosure = useDisclosure(persistId, true);
  const { replaceOpen } = disclosure;
  const finding = isFindingItem(item);
  React.useEffect(() => {
    if (!selected) return;
    replaceOpen(true);
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected, replaceOpen]);
  return (
    <article
      ref={ref}
      data-review-item={item.key}
      data-selected={selected || undefined}
      className={cn(
        CARD,
        'flex min-w-0 scroll-my-6 flex-col overflow-hidden font-sans',
        REVIEW_SELECTED,
        className
      )}
    >
      {!finding && <NoteBar item={item} disclosure={disclosure} action={action} />}
      {finding && (
        <div className='flex flex-col gap-2 p-3'>
          <NoteHead label={<NoteLabel item={item} />} title={item.title} body={item.body} action={action} />
          <NoteDetails persistId={persistId} task={task} item={item} compact={compact} />
        </div>
      )}
      {!finding && disclosure.open && (
        <div className='flex flex-col gap-2 p-3'>
          {item.lead && (
            <InlineMarkdown text={item.lead} className='font-medium text-fg-4 text-xs leading-5' />
          )}
          <Markdown text={item.body} className={cn('text-xs', item.lead ? 'text-fg-3' : 'text-fg-4')} />
          <NoteDetails persistId={persistId} task={task} item={item} compact={compact} />
        </div>
      )}
    </article>
  );
}
