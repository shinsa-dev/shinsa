import { resolveQueue, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { COMPACT_POPOVER_INSET, QUEUE_POPOVER } from '@/components/layout/compact-section.tsx';
import { TaskQueue } from '@/components/queue/queue.tsx';
import { describeNeedsCount } from '@/lib/queue.ts';

export function QueueMenu({ state, activeTaskId }: { state: ShinsaState; activeTaskId: string | null }) {
  const [open, setOpen] = React.useState(false);
  const count = resolveQueue(state, Date.now()).ready.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='secondary'
            size='sm'
            icon={{ name: 'IconChevronDownSmall', position: 'inline-end' }}
            className='pl-1.5 text-fg-3'
          >
            <span className='flex items-center gap-1'>
              <Icon name='IconInboxEmpty' />
              <span className='tabular-nums'>{describeNeedsCount(count)}</span>
            </span>
          </Button>
        }
      />
      <PopoverContent
        align='start'
        sideOffset={6}
        collisionAvoidance={{ fallbackAxisSide: 'none' }}
        className={cn(QUEUE_POPOVER, 'overflow-y-auto')}
      >
        <TaskQueue
          state={state}
          variant='compact'
          activeTaskId={activeTaskId}
          className={COMPACT_POPOVER_INSET}
          activity={false}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
