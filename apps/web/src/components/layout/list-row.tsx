import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

export const LIST_ROW =
  'corner-superellipse/1.125 flex w-full cursor-pointer gap-2 rounded-control text-left outline-none';

export const LIST_ROW_LINES = 'items-start pt-1.5 pb-1';

export const LIST_ROW_LINE = 'h-7 items-center';

export const LIST_ROW_TITLE = 'text-fg-4 text-xs';

export const LIST_ROW_META = 'text-2xs text-fg-2';

const LIST_ROW_SIZE = {
  md: { line: LIST_ROW_LINE, title: LIST_ROW_TITLE },
  sm: { line: 'h-6 items-center', title: 'text-2xs font-medium text-fg-3' },
};

export function ListRow({
  leading,
  title,
  mark,
  meta,
  summary,
  trailing,
  active = false,
  revealWhenActive = false,
  holdsLinks = false,
  size = 'md',
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
  holdsLinks?: boolean;
  size?: keyof typeof LIST_ROW_SIZE;
  onClick: () => void;
}) {
  const ref = React.useRef<HTMLButtonElement & HTMLDivElement>(null);
  React.useEffect(() => {
    if (active && revealWhenActive) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active, revealWhenActive]);
  const row = {
    ref,
    onClick,
    'aria-current': active || undefined,
    'data-active': active,
    'data-highlight-item': '',
    className: cn(
      LIST_ROW,
      meta || summary ? LIST_ROW_LINES : LIST_ROW_SIZE[size].line,
      leading ? 'px-1.5' : 'px-2.5'
    ),
  };
  const content = (
    <>
      {leading}
      <span className='flex min-w-0 flex-1 flex-col'>
        {mark ? (
          <span className='flex min-w-0 items-center gap-1.5'>
            <Truncate className={cn(LIST_ROW_SIZE[size].title, 'min-w-0')}>{title}</Truncate>
            {mark}
          </span>
        ) : (
          <Truncate className={cn(LIST_ROW_SIZE[size].title, 'contain-inline-size')}>{title}</Truncate>
        )}
        {meta && <Truncate className={LIST_ROW_META}>{meta}</Truncate>}
        {summary && <span className={cn(LIST_ROW_META, 'flex h-4 min-w-0 items-center')}>{summary}</span>}
      </span>
      {trailing && <span className='shrink-0 text-2xs leading-5 text-fg-2 tabular-nums'>{trailing}</span>}
    </>
  );
  if (holdsLinks)
    return (
      // oxlint-disable-next-line shinsa/use-semantic-elements -- the row holds a link, and a link cannot sit inside a button
      <div
        {...row}
        role='button'
        tabIndex={0}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
            event.preventDefault();
            onClick();
          }
        }}
      >
        {content}
      </div>
    );
  return (
    <button {...row} type='button'>
      {content}
    </button>
  );
}
