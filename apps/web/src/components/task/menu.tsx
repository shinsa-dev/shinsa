import { isTaskSettled, type ShinsaState, type Task } from '@shinsa/core';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { AccountSubmenu } from '@/components/accounts/account-items.tsx';
import { OptionsTrigger } from '@/components/controls/options-trigger.tsx';
import { TaskActionItems } from '@/components/task/action-items.tsx';
import { DependencyItems } from '@/components/task/dependency-items.tsx';
import { useEngineCommands, useMachine } from '@/lib/connection/socket.ts';
import { listTaskActions } from '@/lib/tasks/actions.ts';

export function TaskMenu({ state, task }: { state: ShinsaState; task: Task }) {
  const commands = useEngineCommands(task.id);
  const teammate = useMachine(task.id)?.teammate ?? null;
  if (listTaskActions(task, commands, Date.now(), teammate).length === 0) return null;
  return (
    <DropdownMenu>
      <OptionsTrigger label='Task actions' />
      <DropdownMenuContent align='end' className='min-w-48'>
        <DependencyItems state={state} task={task} />
        <AccountSubmenu task={task} />
        {!isTaskSettled(task) && <DropdownMenuSeparator />}
        <TaskActionItems task={task} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
