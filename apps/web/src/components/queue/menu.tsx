import { resolveQueue, type ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import * as React from 'react';
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
        className='max-h-(--available-height) w-80 gap-0 overflow-y-auto p-0 [--glyph-ring:var(--color-popover)]'
      >
        <TaskQueue
          state={state}
          variant='compact'
          activeTaskId={activeTaskId}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
