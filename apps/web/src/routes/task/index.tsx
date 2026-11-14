import { isSummarizedTask, type ShinsaState, type Task } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { useMediaQuery } from '@shinsa/ui/hooks/use-media-query';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { CARDS_FRAME, PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PHONE_QUERY } from '@/components/layout/sidebar/compact-bar.tsx';
import { CARD } from '@/components/layout/surface/card.ts';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { TaskCommandRunner } from '@/components/task/command-runner.tsx';
import {
  TaskCompactHeader,
  TaskHeader,
  TaskPageCommands,
  TaskScrollHeader,
  TaskScrollHeaderSlot,
  TaskScrollingHeader,
} from '@/components/task/header.tsx';
import { useReadOnly } from '@/components/task/read-only.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { useIdle, useIdleValue } from '@/hooks/use-idle.ts';
import { applyNowTarget, type TaskView, useTaskView } from '@/hooks/use-task-view.ts';
import { selectWatchOfHome } from '@/lib/automations.ts';
import { removeCarriedCaret } from '@/lib/chat/task-drafts.ts';
import { useEngineFeature, useTaskDetail, useTeamFeed } from '@/lib/connection/socket.ts';
import { useLayoutPreference } from '@/lib/preferences/layout.ts';
import { resolveLineComments } from '@/lib/tasks/messages.ts';
import type { TaskTab } from '@/lib/tasks/tabs.ts';
import { resolveTeamTaskPath, resolveTeamTaskTarget, selectTeamFeedTask } from '@/lib/teams/feeds.ts';
import { replaceRoute, resolveAutomationPath, resolveCanonicalTaskPath, selectRouteTask } from '@/router.ts';
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
          fallbackLead={<TaskScrollHeader />}
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

function PhoneTaskPage({
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
  const coding = view.tab === 'code';
  const onTabIntent = (tab: TaskTab) => {
    if (tab === 'code') void prefetchCode(task);
  };
  const readOnly = useReadOnly();
  return (
    <TaskScrollHeaderSlot
      value={
        <TaskScrollingHeader
          state={state}
          task={task}
          view={view}
          onTabIntent={onTabIntent}
          className={PAGE_COLUMN}
        />
      }
    >
      <div
        className={cn('flex min-h-0 min-w-0 flex-1 flex-col', framed && coding && cn(CARDS_FRAME, 'pb-4'))}
      >
        {!readOnly && <TaskPageCommands state={state} task={task} view={view} />}
        {coding && (
          <TaskCompactHeader
            task={task}
            view={view}
            onTabIntent={onTabIntent}
            className={cn(!framed && PAGE_COLUMN, 'shrink-0 py-2')}
          />
        )}
        <TaskTabs state={state} task={task} view={view} framed={framed} />
      </div>
    </TaskScrollHeaderSlot>
  );
}

function SidebarTaskPage({ state, task, view }: { state: ShinsaState; task: Task; view: TaskView }) {
  const coding = view.tab === 'code';
  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <div className={cn('shrink-0', coding && 'border-b border-border')}>
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
    <div className={cn(CARDS_FRAME, 'flex min-h-0 flex-1 flex-col pb-4', !coding && 'max-sm:px-0')}>
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
  const phone = useMediaQuery(PHONE_QUERY);
  if (phone) return <PhoneTaskPage state={state} task={task} view={view} framed={layout === 'cards'} />;
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

function useTeamFallback(task: Task | null, reference: string) {
  const feed = useTeamFeed();
  const entry = task ? null : selectTeamFeedTask(feed, reference);
  const path = entry ? resolveTeamTaskPath(resolveTeamTaskTarget(entry)) : null;
  React.useEffect(() => {
    if (path) replaceRoute(path);
  }, [path]);
  return path;
}

function useCarryEndsWithPage(taskId: string | null) {
  React.useEffect(() => {
    if (!taskId) return;
    return () => removeCarriedCaret(taskId);
  }, [taskId]);
}

export function TaskPage({ state, taskId }: { state: ShinsaState; taskId: string }) {
  const resolved = selectRouteTask(state, taskId);
  const view = useTaskView(state, resolved?.id ?? taskId);
  const { task } = view;
  useCanonicalPath(state, task, taskId);
  usePrefetchCode(task, view.tabs, view.tab);
  usePrefetchTaskPage(state, task?.id ?? null);
  useCarryEndsWithPage(task?.id ?? null);
  useTaskDetail(task?.id ?? null);
  const supported = useEngineFeature('message.line_comments', task?.id ?? null);
  const teamPath = useTeamFallback(task, taskId);
  if (!task && teamPath) return <LoadingLine label='Opening the team task' className='m-auto' />;
  if (!task) {
    return <EmptyState icon='IconInboxEmpty' title='No such task' description='It may have been removed.' />;
  }
  if (task.watchHome) return null;
  if (isSummarizedTask(task)) {
    return (
      <div className={cn(PAGE_COLUMN, PAGE_TOP)}>
        <LoadingLine label='Reading the task' />
      </div>
    );
  }
  return (
    <ReviewDraftProvider
      {...resolveLineComments(state, task, { reviewing: view.reviewing, supported })}
      reviewing={view.reviewing}
      draftKey={view.draftKey}
      choiceKey={view.choiceKey}
    >
      <TaskCommandRunner state={state} task={task}>
        <TaskFrame state={state} task={task} view={view} />
      </TaskCommandRunner>
    </ReviewDraftProvider>
  );
}
