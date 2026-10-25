import type { Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { describeRequest } from '@/lib/tasks/request.ts';

export function TaskHeading({ task, className }: { task: Task; className?: string }) {
  const [open, setOpen] = React.useState(false);
  const request = describeRequest(task);
  const description = cn(PAGE_DESCRIPTION, 'text-left', !open && 'line-clamp-2');
  return (
    <PageHeading
      className={className}
      title={task.title}
      description={
        request &&
        (request.long ? (
          <button
            type='button'
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={cn(
              description,
              'cursor-pointer whitespace-pre-line outline-none hover:text-fg-3 active:text-fg-3'
            )}
          >
            {request.text}
          </button>
        ) : (
          <p className={description}>{request.text}</p>
        ))
      }
    />
  );
}
