import type { ShinsaState, Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { Choice } from '@/components/controls/choice.tsx';
import { TaskServicesMenu } from '@/components/services/task-menu.tsx';
import { TaskFacts } from '@/components/task/facts.tsx';
import { TaskHeading } from '@/components/task/heading.tsx';
import { TaskMenu } from '@/components/task/menu.tsx';
import { useTaskPageCommands } from '@/hooks/use-task-page-commands.ts';
import type { TaskView } from '@/hooks/use-task-view.ts';
import { TASK_TAB, type TaskTab } from '@/lib/tasks/tabs.ts';

export function TaskHeader({
  state,
  task,
  view,
  onTabIntent,
  className,
}: {
  state: ShinsaState;
  task: Task;
  view: TaskView;
  onTabIntent?: (tab: TaskTab) => void;
  className?: string;
}) {
  useTaskPageCommands(state, task, view);
  return (
    <div className={cn('flex shrink-0 flex-col gap-2.5', className)}>
      <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
        <TaskHeading task={task} className='min-w-60 flex-1 py-0.5' />
        <Choice
          label='Task view'
          items={view.tabs.map((tab) => ({ value: tab, label: TASK_TAB[tab].label }))}
          value={view.tab}
          onValueChange={view.applyTab}
          onItemIntent={onTabIntent}
          className='shrink-0'
        />
      </div>
      <div className='flex items-start gap-2'>
        <TaskFacts state={state} task={task} className='min-w-0 flex-1' />
        <div className='flex h-6 shrink-0 items-center gap-2'>
          <TaskServicesMenu state={state} task={task} />
          <TaskMenu state={state} task={task} />
        </div>
      </div>
    </div>
  );
}
