import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';

// A list of things to do, each a row with its check on the left and its words
// on the right. The check is whatever the caller passes: a `Checkbox` when the
// row can be ticked, a `ChecklistMark` when it is only shown (a Markdown task
// list). The kit draws the rows; reading the items, ticking them and any action
// a row offers belong to the app.
function Checklist({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot='checklist' className={cn('flex flex-col gap-3', className)} {...props} />;
}

// The header over a list: its title on the left, how far along it is on the
// right ("2 of 3 done").
function ChecklistHeader({
  title,
  progress,
  className,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> & { title: React.ReactNode; progress?: React.ReactNode }) {
  return (
    <div
      data-slot='checklist-header'
      className={cn('flex items-baseline justify-between gap-3', className)}
      {...props}
    >
      <span className='font-medium text-fg-4 text-xs leading-5'>{title}</span>
      {progress !== undefined && <span className='text-2xs text-fg-2 tabular-nums'>{progress}</span>}
    </div>
  );
}

// One row. The check sits in a column one line tall (20px, the title's line),
// so it lines up with the first line of a title that wraps.
function ChecklistItem({
  done,
  check,
  className,
  children,
  ...props
}: React.ComponentProps<'li'> & { done: boolean; check: React.ReactNode }) {
  return (
    <li
      data-slot='checklist-item'
      data-done={done || undefined}
      className={cn('flex gap-2.5', className)}
      {...props}
    >
      <span data-slot='checklist-check' className='flex h-5 shrink-0 items-center'>
        {check}
      </span>
      <div data-slot='checklist-content' className='flex min-w-0 flex-1 flex-col gap-1'>
        {children}
      </div>
    </li>
  );
}

// The title line: the title, then what kind of item it is (`meta`), wrapping
// under it when the row is narrow. A done item's title steps down to fg-3.
function ChecklistTitle({
  meta,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { meta?: React.ReactNode }) {
  return (
    <div
      data-slot='checklist-title'
      className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-px', className)}
      {...props}
    >
      <span className='font-medium in-data-done:text-fg-3 text-fg-4 text-xs leading-5'>{children}</span>
      {meta && <span className='flex items-center gap-1 text-2xs text-fg-2'>{meta}</span>}
    </div>
  );
}

function ChecklistDetail({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot='checklist-detail' className={cn('text-fg-3 text-xs', className)} {...props} />;
}

// What a row offers under its words: a command to copy, a button to run it.
function ChecklistActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='checklist-actions'
      className={cn('flex flex-col items-start gap-1.5', className)}
      {...props}
    />
  );
}

// A check that shows a state and cannot be ticked: the compact checkbox's box,
// drawn without a control, so a read-only list looks like the one you tick.
function ChecklistMark({
  done,
  label = done ? 'Done' : 'Not done',
  className,
  ...props
}: React.ComponentProps<'span'> & { done: boolean; label?: string }) {
  return (
    <span
      data-slot='checklist-mark'
      data-done={done || undefined}
      role='img'
      aria-label={label}
      className={cn(
        'relative inline-grid size-3.5 shrink-0 place-items-center rounded-checkbox border border-icon-1 bg-background text-primary-foreground',
        'data-done:border-primary-4 data-done:bg-primary-4',
        className
      )}
      {...props}
    >
      {done && (
        <span className='absolute -inset-px grid place-items-center'>
          <Icon name='IconCheckmark1Small' size='sm' aria-hidden />
        </span>
      )}
    </span>
  );
}

export {
  Checklist,
  ChecklistActions,
  ChecklistDetail,
  ChecklistHeader,
  ChecklistItem,
  ChecklistMark,
  ChecklistTitle,
};
