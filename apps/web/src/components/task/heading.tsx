import type { Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_DESCRIPTION, PageHeading } from '@/components/layout/page/heading.tsx';
import { resolveTaskDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import { describeRequest } from '@/lib/tasks/request.ts';

export function TaskHeading({ task, className }: { task: Task; className?: string }) {
  const { open, toggle } = useDisclosure(resolveTaskDisclosureId(task.id, 'request'), false);
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
            onClick={toggle}
            className={cn(
              description,
              'cursor-pointer whitespace-pre-line outline-none hover:text-fg-3 active:text-fg-3'
            )}
          >
            {request.text}
          </button>
        ) : (
          <p className={cn(description, 'selectable')}>{request.text}</p>
        ))
      }
    />
  );
}
