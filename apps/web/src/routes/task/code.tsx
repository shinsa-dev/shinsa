import type { Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Workbench } from '@/components/code/workbench.tsx';
import { useTaskRefs } from '@/lib/connection/code.ts';
import type { ExplorerMode } from '@/lib/tasks/tabs.ts';

export function CodeTab({ task, modes }: { task: Task; modes: ExplorerMode[] }) {
  const refs = useTaskRefs(task);
  if (refs.status === 'idle' || refs.status === 'loading') {
    return (
      <div className='flex items-center gap-2 p-3 text-fg-2 text-xs'>
        <Spinner size='sm' /> Reading the code
      </div>
    );
  }
  if (refs.status === 'error') {
    return (
      <EmptyState size='sm' icon='IconFolder1' title='The code is not available' description={refs.message} />
    );
  }
  return <Workbench task={task} refs={refs.value} modes={modes} />;
}
