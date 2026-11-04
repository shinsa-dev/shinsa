import type { ShinsaState, Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { Choice } from '@/components/controls/choice.tsx';
import { TaskFacts } from '@/components/task/facts.tsx';
import { TaskHeading } from '@/components/task/heading.tsx';
import { TaskMenu } from '@/components/task/menu.tsx';
import { useReadOnly, useReadOnlyNote } from '@/components/task/read-only.tsx';
import { HandoffBanner, SharingBanner } from '@/components/task/sharing-banner.tsx';
import { useTaskPageCommands } from '@/hooks/use-task-page-commands.ts';
import type { TaskView } from '@/hooks/use-task-view.ts';
import { TASK_TAB, type TaskTab } from '@/lib/tasks/tabs.ts';

function TaskPageCommands({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  useTaskPageCommands(state, task, view);
  return null;
}

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
  const readOnly = useReadOnly();
  const note = useReadOnlyNote();
  return (
    <div className={cn('flex shrink-0 flex-col gap-2.5', className)}>
      {note}
      {!readOnly && <SharingBanner task={task} />}
      {!readOnly && <HandoffBanner task={task} />}
      {!readOnly && <TaskPageCommands state={state} task={task} view={view} />}
      <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
        <TaskHeading task={task} className='min-w-60 flex-1 py-0.5' />
        <div data-task-tabs className='shrink-0'>
          <Choice
            label='Task view'
            items={view.tabs.map((tab) => ({ value: tab, label: TASK_TAB[tab].label }))}
            value={view.tab}
            onValueChange={view.applyTab}
            onItemIntent={onTabIntent}
          />
        </div>
      </div>
      <div className='flex items-start gap-2'>
        <TaskFacts state={state} task={task} className='min-w-0 flex-1' />
        {!readOnly && (
          <div className='flex h-6 shrink-0 items-center gap-2'>
            <TaskMenu state={state} task={task} />
          </div>
        )}
      </div>
    </div>
  );
}
