import { type ShinsaState, selectTaskByReference, type Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { CARDS_FRAME, PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskCommandRunner } from '@/components/task/command-runner.tsx';
import { TaskHeader } from '@/components/task/header.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';
import { applyNowTarget, type TaskView, useTaskView } from '@/hooks/use-task-view.ts';
import { selectWatchOfHome } from '@/lib/automations.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import type { TaskTab } from '@/lib/tasks/tabs.ts';
import { replaceRoute, resolveAutomationPath, resolveCanonicalTaskPath } from '@/router.ts';
import { ChatTab } from './chat.tsx';
import { CodeTab, prefetchCode, usePrefetchCode } from './lazy-code.tsx';
import { OverviewTab } from './overview.tsx';
import { usePrefetchTaskPage } from './prefetch.tsx';
import { ReviewTab } from './review.tsx';

interface TabContentProps {
  tab: TaskTab;
  state: ShinsaState;
  task: Task;
  lead: TaskView['lead'];
  codeModes: TaskView['codeModes'];
  chatRunId: string | null;
}

function isSameTabContent(before: TabContentProps, after: TabContentProps) {
  return (
    before.tab === after.tab &&
    before.state === after.state &&
    before.task === after.task &&
    before.lead === after.lead &&
    before.chatRunId === after.chatRunId &&
    before.codeModes.join() === after.codeModes.join()
  );
}

const TaskTabContent = React.memo(function TabContent({
  tab,
  state,
  task,
  lead,
  codeModes,
  chatRunId,
}: TabContentProps) {
  switch (tab) {
    case 'overview':
      return <OverviewTab state={state} task={task} gate={lead} onOpen={applyNowTarget} />;
    case 'review':
      return <ReviewTab state={state} task={task} />;
    case 'code':
      return <CodeTab task={task} modes={codeModes} />;
    case 'chat':
      return <ChatTab state={state} task={task} focusRunId={chatRunId} />;
  }
}, isSameTabContent);

function TaskTabs({
  state,
  task,
  view,
  framed,
}: {
  state: ShinsaState;
  task: Task;
  view: TaskView;
  framed: boolean;
}) {
  const warm = useIdle();
  const settled = useIdleValue(state);
  const visited = React.useRef(new Set<TaskTab>());
  visited.current.add(view.tab);
  return view.tabs
    .filter((tab) => warm || visited.current.has(tab))
    .map((tab) => {
      const content = (
        <ErrorBoundary
          size='inline'
          resetKey={tab === view.tab ? task.id : 'hidden'}
          className={cn(PAGE_COLUMN, 'py-5')}
        >
          <TaskTabContent
            tab={tab}
            state={tab === view.tab ? state : settled}
            task={task}
            lead={view.lead}
            codeModes={view.codeModes}
            chatRunId={view.chatRunId}
          />
        </ErrorBoundary>
      );
      return (
        <React.Activity key={tab} mode={tab === view.tab ? 'visible' : 'hidden'}>
          {framed && tab === 'code' ? (
            <div className={cn(CARD, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>{content}</div>
          ) : (
            content
          )}
        </React.Activity>
      );
    });
}

function SidebarTaskPage({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  const coding = view.tab === 'code';
  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <div className={cn('shrink-0', coding && 'border-border border-b')}>
        <TaskHeader
          state={state}
          task={task}
          view={view}
          onTabIntent={(tab) => {
            if (tab === 'code') void prefetchCode(task);
          }}
          className={cn(PAGE_COLUMN, PAGE_TOP, coding ? 'pb-3' : 'pb-1')}
        />
      </div>
      <TaskTabs state={state} task={task} view={view} framed={false} />
    </div>
  );
}

function CardsTaskPage({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  const coding = view.tab === 'code';
  return (
    <div className={cn(CARDS_FRAME, 'flex min-h-0 flex-1 flex-col pb-4')}>
      <TaskHeader
        state={state}
        task={task}
        view={view}
        onTabIntent={(tab) => {
          if (tab === 'code') void prefetchCode(task);
        }}
        className={cn(PAGE_COLUMN, PAGE_TOP, coding ? 'pb-3' : 'pb-1')}
      />
      <TaskTabs state={state} task={task} view={view} framed />
    </div>
  );
}

export function TaskFrame({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  const layout = useLayoutPreference();
  const Frame = layout === 'cards' ? CardsTaskPage : SidebarTaskPage;
  return <Frame state={state} task={task} view={view} />;
}

function useCanonicalPath(state: ShinsaState, task: Task | null, segment: string) {
  const watch = task ? selectWatchOfHome(state, task.id) : null;
  const canonical = task ? resolveCanonicalTaskPath(task, segment, location.search) : null;
  const path = watch ? resolveAutomationPath(watch.id) : canonical;
  React.useEffect(() => {
    if (path) replaceRoute(path);
  }, [path]);
}

export function TaskPage({ state, taskId }: { state: ShinsaState; taskId: string }) {
  const resolved = selectTaskByReference(state, taskId);
  const view = useTaskView(state, resolved?.id ?? taskId);
  const { task } = view;
  useCanonicalPath(state, task, taskId);
  usePrefetchCode(task, view.tabs, view.tab);
  usePrefetchTaskPage(state, task?.id ?? null);
  if (!task) {
    return <EmptyState icon='IconInboxEmpty' title='No such task' description='It may have been removed.' />;
  }
  if (task.watchHome) return null;
  return (
    <ReviewDraftProvider enabled={view.reviewing} draftKey={view.draftKey}>
      <TaskCommandRunner state={state} task={task}>
        <TaskFrame state={state} task={task} view={view} />
      </TaskCommandRunner>
    </ReviewDraftProvider>
  );
}
