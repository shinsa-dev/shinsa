import type { Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { Spinner } from '@shinsa/ui/components/spinner';
import { ChangesPane } from '@/components/code/changes.tsx';
import { ReviewPane } from '@/components/code/review.tsx';
import { useTaskDiff } from '@/lib/connection/files.ts';
import type { CodeView } from '@/lib/tasks/tabs.ts';

function TaskDiff({ task, view }: { task: Task; view: CodeView }) {
  const loaded = useTaskDiff(task.id, task.updatedAt);
  if (loaded.status === 'idle' || loaded.status === 'loading') {
    return (
      <div className='flex items-center gap-2 p-3 text-fg-2 text-xs'>
        <Spinner size='sm' /> Reading the changes
      </div>
    );
  }
  if (loaded.status === 'error') return <p className='p-3 text-fg-2 text-xs'>{loaded.message}</p>;
  if (loaded.value.files.length === 0) {
    return (
      <EmptyState
        size='sm'
        icon='IconCode'
        title='No changes yet'
        description='Nothing on this branch differs from its base.'
      />
    );
  }
  if (view === 'review') return <ReviewPane task={task} diff={loaded.value} />;
  return <ChangesPane task={task} diff={loaded.value} />;
}

export function CodeTab({ task, view }: { task: Task; view: CodeView }) {
  if (!task.worktreePath) {
    return (
      <EmptyState
        size='sm'
        icon='IconFolder1'
        title='The worktree is gone'
        description='The code for this task is no longer on disk.'
      />
    );
  }
  return <TaskDiff task={task} view={view} />;
}
