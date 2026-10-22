'use client';

import { Button } from '@shinsa/ui/components/button';
import { useLink } from '@shinsa/ui/components/link';
import { NumberFlow } from '@shinsa/ui/components/number-flow';
import { ScrollFade } from '@shinsa/ui/components/scroll-fade';
import { cn } from '@shinsa/ui/lib/utils';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';

const unfold = { type: 'spring', duration: 0.3, bounce: 0 } as const;
const fold = { type: 'spring', duration: 0.2, bounce: 0 } as const;

function Table({ className, children, ...props }: React.ComponentProps<'table'>) {
  const parts = React.Children.toArray(children);
  const pinned = parts.filter((part) => React.isValidElement(part) && part.type === TablePagination);
  const inside = parts.filter((part) => !pinned.includes(part));
  const viewportRef = React.useRef<HTMLDivElement>(null);

  return (
    <div data-slot='table-root' className='flex min-h-0 w-full flex-col'>
      <ScrollFade orientation='horizontal' targetRef={viewportRef} />
      <div
        ref={viewportRef}
        data-slot='table-viewport'
        className='group/table relative min-h-0 flex-1 overflow-auto [&[data-overflow-x-start]]:[--fade-l:0px]!'
      >
        <table
          data-slot='table'
          className={cn(
            'w-full caption-bottom border-separate border-spacing-0 text-xs max-lg:table-auto',
            className
          )}
          {...props}
        >
          {inside}
        </table>
      </div>
      {pinned}
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot='table-header' className={cn('sticky top-0 z-10 bg-card', className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody data-slot='table-body' className={cn('[&_tr:last-child_td]:border-b-0', className)} {...props} />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn('border-bg-3 border-t font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot='table-row'
      className={cn(
        'transition-[color,background-color,border-color,--row-tint] duration-150 ease-out [--row-tint:transparent] hover:bg-bg-a1/60 active:bg-bg-a1/60 data-[state=selected]:bg-bg-a1 hover:[--row-tint:color-mix(in_oklab,var(--color-bg-a1)_60%,transparent)] active:[--row-tint:color-mix(in_oklab,var(--color-bg-a1)_60%,transparent)] data-[state=selected]:[--row-tint:var(--color-bg-a1)]',
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot='table-head'
      className={cn(
        'h-7 whitespace-nowrap border-bg-3 border-b px-2.5 text-left align-middle font-medium text-fg-2 text-xs first:pl-3 last:pr-3',
        'first:sticky first:left-0 first:z-20 first:bg-[image:linear-gradient(var(--row-tint),var(--row-tint))] first:bg-card first:group-data-overflow-x-start/table:shadow-[1px_0_0_var(--color-bg-3)]',
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot='table-cell'
      className={cn(
        'whitespace-nowrap border-bg-3 border-b px-2.5 py-1.5 align-middle text-fg-3 first:pl-3 last:pr-3',
        'first:sticky first:left-0 first:z-1 first:bg-[image:linear-gradient(var(--row-tint),var(--row-tint))] first:bg-card first:group-data-overflow-x-start/table:shadow-[1px_0_0_var(--color-bg-3)]',
        className
      )}
      {...props}
    />
  );
}

function TableDetail({
  open,
  colSpan,
  className,
  children,
}: {
  open: boolean;
  colSpan: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.tr key='detail' data-slot='table-detail'>
          <td colSpan={colSpan} className={cn('border-bg-3 border-b p-0', className)}>
            <motion.div
              className='overflow-hidden'
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0, transition: fold }}
              transition={unfold}
            >
              {children}
            </motion.div>
          </td>
        </motion.tr>
      )}
    </AnimatePresence>
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot='table-caption' className={cn('mt-3 text-fg-2 text-xs', className)} {...props} />;
}

function TablePagination({
  page,
  pageCount,
  total = null,
  previous,
  next,
  className,
}: {
  page: number;
  pageCount: number | null;
  total?: number | null;
  previous: string | null;
  next: string | null;
  className?: string;
}) {
  const Link = useLink();
  const canGoBack = page > 1 && previous !== null;
  const canGoForward = (pageCount === null || page < pageCount) && next !== null;
  if (pageCount === 1 || (pageCount === null && !canGoBack && !canGoForward)) return null;

  return (
    <div
      data-slot='table-pagination'
      className={cn(
        'flex h-7 shrink-0 items-center justify-between border-bg-3 border-t px-3 text-fg-2 text-xs',
        className
      )}
    >
      <span className='tabular-nums'>
        Page <NumberFlow value={page} />
        {pageCount !== null && (
          <>
            {' / '}
            <NumberFlow value={pageCount} />
          </>
        )}
        {total !== null && (
          <span className='text-fg-1'>
            {' '}
            (<NumberFlow value={total} />)
          </span>
        )}
      </span>
      <span className='-mr-2 flex items-center'>
        <Button
          variant='secondary'
          size='xs'
          icon='IconChevronLeftMedium'
          nativeButton={false}
          disabled={!canGoBack}
          render={<Link to={canGoBack && previous ? previous : '.'} />}
        >
          Previous
        </Button>
        <Button
          variant='secondary'
          size='xs'
          icon={{ name: 'IconChevronRightMedium', position: 'inline-end' }}
          nativeButton={false}
          disabled={!canGoForward}
          render={<Link to={canGoForward && next ? next : '.'} />}
        >
          Next
        </Button>
      </span>
    </div>
  );
}

export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableDetail,
  TableFooter,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
};
