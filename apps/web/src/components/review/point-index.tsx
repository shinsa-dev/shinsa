import { Button } from '@shinsa/ui/components/button';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARD, CARD_HEADER } from '@/components/layout/surface/card.ts';
import { resolveDisclosureStrip, TRAILING_BOX } from '@/components/layout/surface/disclosure.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import {
  describeItemPlace,
  describeStopPosition,
  type ReviewChapter,
  type ReviewStop,
} from '@/lib/review/report.ts';
import { type ReviewSelection, useCurrentStop } from '@/lib/review/selection.ts';

function StopRow({
  stop,
  current,
  onSelect,
}: {
  stop: ReviewStop;
  current: boolean;
  onSelect: (key: string) => void;
}) {
  const item = stop.item;
  return (
    <li>
      <button
        type='button'
        data-selected={current || undefined}
        data-active={current}
        data-highlight-item=''
        aria-current={current ? 'location' : undefined}
        onClick={() => onSelect(stop.key)}
        className='flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 text-start text-xs'
      >
        <span className='flex w-5 shrink-0 justify-end text-2xs text-fg-2 tabular-nums'>
          {stop.icon ? <Icon size='sm' name={stop.icon} /> : stop.number}
        </span>
        {item && (
          <span className='flex w-26 shrink-0'>
            <ToneLabel label={item.label} tone={item.tone} />
          </span>
        )}
        <Truncate className={cn('min-w-0 flex-1', item ? 'text-fg-4' : 'text-fg-3')}>{stop.title}</Truncate>
        {item?.place && (
          <span className='hidden max-w-56 shrink-0 truncate font-mono text-2xs text-fg-2 md:inline'>
            {describeItemPlace(item.place)}
          </span>
        )}
      </button>
    </li>
  );
}

function IndexChevron({ open }: { open: boolean }) {
  return (
    <Button
      variant='secondary'
      size='icon-xs'
      nativeButton={false}
      render={<span />}
      tabIndex={-1}
      aria-hidden
      className={cn('ms-auto', TRAILING_BOX)}
    >
      <Icon
        name='IconChevronDownSmall'
        className={cn('transition-[rotate] duration-150', !open && '-rotate-90')}
      />
    </Button>
  );
}

function IndexPlace({ stop, total }: { stop: ReviewStop | null; total: number }) {
  const position = stop && describeStopPosition(stop, total);
  if (!stop) return <span className='shrink-0 font-normal text-fg-2 tabular-nums'>{total}</span>;
  return (
    <span className='flex min-w-0 flex-1 items-center gap-1.5 font-normal text-fg-2'>
      {position && <span className='shrink-0 tabular-nums'>{position}</span>}
      {position && <span className='shrink-0'>·</span>}
      <span className='shrink-0'>{stop.chapterTitle}</span>
      {stop.title !== stop.chapterTitle && (
        <>
          <span className='shrink-0'>·</span>
          <Truncate className='min-w-0 text-fg-3'>{stop.title}</Truncate>
        </>
      )}
    </span>
  );
}

export function PointIndex({
  chapters,
  stops,
  selection,
  onSelect,
}: {
  chapters: ReviewChapter[];
  stops: ReviewStop[];
  selection: ReviewSelection;
  onSelect: (key: string) => void;
}) {
  const current = useCurrentStop(selection);
  const [open, setOpen] = React.useState(false);
  const list = React.useRef<HTMLDivElement>(null);
  const total = stops.filter((stop) => stop.number !== null).length;
  const here = stops.find((stop) => stop.key === current) ?? null;
  React.useEffect(() => {
    if (open) list.current?.querySelector('[data-selected]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);
  const select = (key: string) => {
    setOpen(false);
    onSelect(key);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label='Every point'
        className={cn(
          CARD,
          'block w-full cursor-pointer select-none overflow-hidden text-start outline-none'
        )}
      >
        <span className={cn(CARD_HEADER, resolveDisclosureStrip('band', 'box'))}>
          <IconSlot>
            <Icon size='sm' name='IconListBullets' />
          </IconSlot>
          <span className='shrink-0'>Every point</span>
          <IndexPlace stop={here} total={total} />
          <IndexChevron open={open} />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        sideOffset={4}
        collisionAvoidance={{ fallbackAxisSide: 'none' }}
        className='max-h-[min(32rem,var(--available-height))] w-(--anchor-width) gap-0 overflow-y-auto p-1.5'
      >
        <HoverHighlight indicatorClassName='rounded-md'>
          <div ref={list} className='flex flex-col gap-2'>
            {chapters.map((chapter) => (
              <div key={chapter.id} className='flex flex-col gap-px'>
                <span className='px-1.5 py-1 text-2xs text-fg-2'>{chapter.title}</span>
                <ol className='flex flex-col'>
                  {stops
                    .filter((stop) => stop.chapter === chapter.id)
                    .map((stop) => (
                      <StopRow key={stop.key} stop={stop} current={stop.key === current} onSelect={select} />
                    ))}
                </ol>
              </div>
            ))}
          </div>
        </HoverHighlight>
      </PopoverContent>
    </Popover>
  );
}
