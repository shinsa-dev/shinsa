import { type ShinsaState, selectTaskByReference, type Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CARDS_FRAME, PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { CARD } from '@/components/layout/surface/card.ts';
import { TaskHeader } from '@/components/task/header.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { type TaskView, useTaskView } from '@/hooks/use-task-view.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { replaceRoute, resolveCanonicalTaskPath } from '@/router.ts';
import { ChatTab } from './chat.tsx';
import { CodeTab, prefetchCode, usePrefetchCode } from './lazy-code.tsx';
import { OverviewTab } from './overview.tsx';
import { ReviewTab } from './review.tsx';

function TaskTabContent({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  switch (view.tab) {
    case 'overview':
      return <OverviewTab state={state} task={task} gate={view.lead} onOpen={view.applyNowTarget} />;
    case 'review':
      return <ReviewTab state={state} task={task} />;
    case 'code':
      return <CodeTab task={task} modes={view.codeModes} />;
    case 'chat':
      return <ChatTab state={state} task={task} focusRunId={view.chatRunId} />;
  }
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
      <TaskTabContent state={state} task={task} view={view} />
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
      {coding ? (
        <div className={cn(CARD, 'flex min-h-0 flex-1 flex-col overflow-hidden')}>
          <TaskTabContent state={state} task={task} view={view} />
        </div>
      ) : (
        <TaskTabContent state={state} task={task} view={view} />
      )}
    </div>
  );
}

function useCanonicalPath(task: Task | null, segment: string) {
  const path = task ? resolveCanonicalTaskPath(task, segment, location.search) : null;
  React.useEffect(() => {
    if (path) replaceRoute(path);
  }, [path]);
}

export function TaskPage({ state, taskId }: { state: ShinsaState; taskId: string }) {
  const resolved = selectTaskByReference(state, taskId);
  const view = useTaskView(state, resolved?.id ?? taskId);
  const layout = useLayoutPreference();
  const { task } = view;
  useCanonicalPath(task, taskId);
  usePrefetchCode(task, view.tabs, view.tab);
  if (!task) {
    return <EmptyState icon='IconInboxEmpty' title='No such task' description='It may have been removed.' />;
  }
  const Frame = layout === 'cards' ? CardsTaskPage : SidebarTaskPage;
  return (
    <ReviewDraftProvider enabled={view.reviewing} draftKey={view.draftKey}>
      <Frame state={state} task={task} view={view} />
    </ReviewDraftProvider>
  );
}
