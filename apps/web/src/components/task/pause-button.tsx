import { isTaskPausable, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { useBusy } from '@/hooks/use-busy.ts';
import { useEngineCommand } from '@/lib/connection/socket.ts';
import { pauseTask, TASK_ACTION } from '@/lib/tasks/actions.ts';

export function PauseButton({ state, task }: { state: ShinsaState; task: Task }) {
  const spoken = useEngineCommand('task.pause', task.id);
  const { busy, run } = useBusy<'pause'>();
  if (!spoken || !isTaskPausable(state, task)) return null;
  return (
    <Button
      variant='secondary'
      size='sm'
      icon={TASK_ACTION.pause.icon}
      loading={busy === 'pause'}
      onClick={() => void run('pause', () => pauseTask(task))}
    >
      {TASK_ACTION.pause.label}
    </Button>
  );
}
