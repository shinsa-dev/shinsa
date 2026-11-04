import type { ShinsaState, Task } from '@shinsa/core';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { PHONE_QUERY } from '@/components/layout/sidebar/compact-bar.tsx';
import { TaskFacts } from '@/components/task/facts.tsx';
import { TaskHeading } from '@/components/task/heading.tsx';
import { TaskMenu } from '@/components/task/menu.tsx';
import { useReadOnly, useReadOnlyNote } from '@/components/task/read-only.tsx';
import { HandoffBanner, SharingBanner } from '@/components/task/sharing-banner.tsx';
import { useTaskPageCommands } from '@/hooks/use-task-page-commands.ts';
import type { TaskView } from '@/hooks/use-task-view.ts';
import { TASK_TAB, type TaskTab } from '@/lib/tasks/tabs.ts';

export function TaskPageCommands({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  useTaskPageCommands(state, task, view);
  return null;
}

export const TaskScrollHeaderSlot = React.createContext<React.ReactNode>(null);

export function TaskScrollHeader() {
  return React.useContext(TaskScrollHeaderSlot);
}

export function useTaskScrollFade() {
  return React.useContext(TaskScrollHeaderSlot) ? 'end' : true;
}

function TaskTabChoice({ view, onTabIntent }: { view: TaskView; onTabIntent?: (tab: TaskTab) => void }) {
  return (
    <Choice
      label='Task view'
      items={view.tabs.map((tab) => ({ value: tab, label: TASK_TAB[tab].label }))}
      value={view.tab}
      onValueChange={view.applyTab}
      onItemIntent={onTabIntent}
      scrolls
    />
  );
}

export function TaskCompactHeader({
  task,
  view,
  onTabIntent,
  className,
}: {
  task: Task;
  view: TaskView;
  onTabIntent?: (tab: TaskTab) => void;
  className?: string;
}) {
  return (
    <div data-task-compact-header className={cn('flex min-w-0 items-center gap-3', className)}>
      <h2 className='min-w-0 flex-1 truncate text-sm leading-tight font-medium text-fg-4'>{task.title}</h2>
      <div className='max-w-full shrink-0'>
        <TaskTabChoice view={view} onTabIntent={onTabIntent} />
      </div>
    </div>
  );
}

export function useHeaderOutOfView() {
  const [out, setOut] = React.useState(false);
  const observe = React.useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setOut(!!entry && entry.intersectionRatio < 1), {
      threshold: [0, 1],
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { out, observe };
}

export function TaskScrollingHeader({
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
  const { out, observe } = useHeaderOutOfView();
  return (
    <>
      <div className='sticky top-0 z-20 h-0'>
        <div
          data-shown={out || undefined}
          aria-hidden={!out}
          inert={!out}
          className='pointer-events-none border-b border-border bg-background py-2 opacity-0 transition-opacity duration-150 data-shown:pointer-events-auto data-shown:opacity-100'
        >
          <TaskCompactHeader task={task} view={view} onTabIntent={onTabIntent} className={className} />
        </div>
      </div>
      <TaskHeader
        state={state}
        task={task}
        view={view}
        onTabIntent={onTabIntent}
        tabsRef={observe}
        className={cn(className, 'pt-2 pb-1')}
      />
    </>
  );
}

export function TaskHeader({
  state,
  task,
  view,
  onTabIntent,
  tabsRef,
  className,
}: {
  state: ShinsaState;
  task: Task;
  view: TaskView;
  onTabIntent?: (tab: TaskTab) => void;
  tabsRef?: React.Ref<HTMLDivElement>;
  className?: string;
}) {
  const scrolling = !!tabsRef;
  const readOnly = useReadOnly();
  const note = useReadOnlyNote();
  const phone = useMediaQuery(PHONE_QUERY);
  const [detailed, setDetailed] = React.useState(false);
  return (
    <div className={cn('flex shrink-0 flex-col gap-2.5', className)}>
      {note}
      {!readOnly && <SharingBanner task={task} />}
      {!readOnly && <HandoffBanner task={task} />}
      {!(readOnly || scrolling) && <TaskPageCommands state={state} task={task} view={view} />}
      <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
        <TaskHeading task={task} className='min-w-60 flex-1 py-0.5' />
        <div ref={tabsRef} data-task-tabs className='max-w-full shrink-0'>
          <TaskTabChoice view={view} onTabIntent={onTabIntent} />
        </div>
      </div>
      <div className='flex items-start gap-2'>
        <TaskFacts
          state={state}
          task={task}
          fold={phone ? { open: detailed, onToggle: () => setDetailed((open) => !open) } : null}
          className='min-w-0 flex-1'
        />
        {!readOnly && (
          <div className='flex h-6 shrink-0 items-center gap-2'>
            <TaskMenu state={state} task={task} />
          </div>
        )}
      </div>
    </div>
  );
}
