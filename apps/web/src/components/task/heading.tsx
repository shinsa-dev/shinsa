import type { Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { describeIntent } from '@/lib/tasks/intent.ts';

export function TaskHeading({ task, className }: { task: Task; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const intent = describeIntent(task);
  const description = cn(PAGE_DESCRIPTION, 'text-left', !open && 'line-clamp-2');
  return (
    <PageHeading
      className={className}
      title={task.title}
      description={
        intent &&
        (intent.long ? (
          <button
            type='button'
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={cn(
              description,
              'cursor-pointer whitespace-pre-line outline-none transition-colors duration-150 hover:text-fg-3 active:text-fg-3'
            )}
          >
            {intent.text}
          </button>
        ) : (
          <p className={description}>{intent.text}</p>
        ))
      }
    />
  );
}
