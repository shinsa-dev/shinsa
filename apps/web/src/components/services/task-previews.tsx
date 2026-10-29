import type { ServiceView, ShinsaState, Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useNow } from '@/hooks/use-now.ts';
import { useTerminals } from '@/lib/connection/terminals.ts';
import { listTaskPreviews, selectServicePreview } from '@/lib/terminal/services.ts';

export function useTaskPreviews(state: ShinsaState, task: Task) {
  const snapshot = useTerminals();
  const now = useNow();
  return listTaskPreviews(state, snapshot, task, now);
}

export function TaskPreviewLinks({ views }: { views: ServiceView[] }) {
  return (
    <div className='flex flex-col gap-1'>
      {views.map((view) => {
        const url = selectServicePreview(view);
        if (!url) return null;
        return (
          <a
            key={view.service.id}
            href={url}
            target='_blank'
            rel='noreferrer'
            className='corner-superellipse/1.125 flex h-8 min-w-0 items-center gap-2 rounded-control bg-bg-2 px-2.5 text-xs hover:bg-bg-3 active:bg-bg-3'
          >
            <Icon size='sm' name='IconArrowUpRight' className='shrink-0 text-fg-2' />
            <span className='shrink-0 font-medium text-fg-4'>{view.service.name}</span>
            <Truncate className='min-w-0 text-2xs text-fg-2'>{url}</Truncate>
          </a>
        );
      })}
    </div>
  );
}
