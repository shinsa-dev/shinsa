import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

export const LIST_ROW =
  'corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none';

export const LIST_ROW_LINES = 'items-start pt-1.5 pb-1';

export const LIST_ROW_LINE = 'h-7 items-center';

export const LIST_ROW_TITLE = 'text-fg-4 text-xs';

export const LIST_ROW_META = 'text-2xs text-fg-2';

export function ListRow({
  leading,
  title,
  mark,
  meta,
  summary,
  trailing,
  active = false,
  revealWhenActive = false,
  onClick,
}: {
  leading?: React.ReactNode;
  title: React.ReactNode;
  mark?: React.ReactNode;
  meta?: React.ReactNode;
  summary?: React.ReactNode;
  trailing?: React.ReactNode;
  active?: boolean;
  revealWhenActive?: boolean;
  onClick: () => void;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (active && revealWhenActive) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active, revealWhenActive]);
  return (
    <button
      ref={ref}
      type='button'
      onClick={onClick}
      aria-current={active || undefined}
      data-active={active}
      data-highlight-item=''
      className={cn(
        LIST_ROW,
        meta || summary ? LIST_ROW_LINES : LIST_ROW_LINE,
        leading ? 'px-1.5' : 'px-2.5'
      )}
    >
      {leading}
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        {mark ? (
          <span className='flex min-w-0 items-center gap-1.5'>
            <Truncate className={cn(LIST_ROW_TITLE, 'min-w-0')}>{title}</Truncate>
            {mark}
          </span>
        ) : (
          <Truncate className={cn(LIST_ROW_TITLE, 'contain-inline-size')}>{title}</Truncate>
        )}
        {meta && <Truncate className={LIST_ROW_META}>{meta}</Truncate>}
        {summary && <span className={cn(LIST_ROW_META, 'flex h-4 min-w-0 items-center')}>{summary}</span>}
      </span>
      {trailing && <span className='shrink-0 text-2xs text-fg-2 tabular-nums leading-5'>{trailing}</span>}
    </button>
  );
}
