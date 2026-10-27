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
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { describeItemPlace, REVIEW_AUTHOR, type ReviewItem } from '@/lib/review/report.ts';

const SELECTED = 'outline-2 outline-offset-2 outline-transparent data-selected:outline-primary-a3';

function SuggestedFix({ text }: { text: string }) {
  return (
    <div className='corner-superellipse/1.125 flex flex-col gap-1 rounded-lg bg-bg-a1 px-3 py-2.5'>
      <span className='flex items-center gap-1.5 text-2xs text-fg-2'>
        <Icon size='sm' name='IconBandage' />
        Suggested fix
      </span>
      <Markdown text={text} className='text-fg-4 text-xs' />
    </div>
  );
}

function RelatedNote({ item }: { item: ReviewItem }) {
  return (
    <div className='flex min-w-0 gap-1.25 text-xs'>
      <IconSlot>
        <Icon size='sm' name={REVIEW_AUTHOR[item.author].icon} />
      </IconSlot>
      <div className='flex min-w-0 flex-1 flex-col gap-px pt-0.5'>
        <span className='flex items-center gap-1.5 text-2xs text-fg-2'>
          The agent marked these lines <ToneLabel label={item.label} tone={item.tone} />
        </span>
        <Markdown text={item.body} className='text-fg-3 text-xs' />
      </div>
    </div>
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

export function ReviewNote({
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
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  const author = REVIEW_AUTHOR[item.author];
  return (
    <article
      ref={ref}
      data-review-item={item.key}
      data-selected={selected || undefined}
      className={cn(CARD, 'flex min-w-0 scroll-my-6 flex-col overflow-hidden font-sans', SELECTED, className)}
    >
      <header className='flex h-9 shrink-0 items-center gap-1.25 bg-bg-a1 px-3 text-xs'>
        <IconSlot>
          <Icon size='sm' name={author.icon} />
        </IconSlot>
        <span className='shrink-0 font-medium text-fg-4'>{author.label}</span>
        <span className='shrink-0 text-fg-2'>·</span>
        <ToneLabel label={item.label} tone={item.tone} />
        {item.section && (
          <>
            <span className='shrink-0 text-fg-2'>·</span>
            <Truncate className='min-w-0 text-2xs text-fg-2'>{item.section}</Truncate>
          </>
        )}
        <span className='flex-1' />
        {action && <span className='flex shrink-0 items-center gap-1.5'>{action}</span>}
      </header>
      <div className='flex flex-col gap-2 p-3'>
        {item.title && (
          <InlineMarkdown text={item.title} className='font-medium text-fg-4 text-xs leading-5' />
        )}
        <Markdown text={item.body} className={cn('text-xs', item.title ? 'text-fg-3' : 'text-fg-4')} />
        {!compact && item.related.map((related) => <RelatedNote key={related.key} item={related} />)}
        <NotePlace task={task} item={item} compact={compact} />
        {item.fix && <SuggestedFix text={item.fix} />}
      </div>
    </article>
  );
}
