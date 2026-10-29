import { isTaskSettled, listWaitsOn, type Repo, type ShinsaState, type Task } from '@shinsa/core';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@shinsa/ui/components/dropdown-menu';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { LazyMenu, LazyMenuTrigger } from '@/components/controls/lazy-menu.tsx';
import { RepoIcon } from '@/components/links/repo.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { StatusText } from '@/components/status/text.tsx';
import { PriorityChoices, TaskActionItems } from '@/components/task/action-items.tsx';
import { DependencyItems } from '@/components/task/dependency-items.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { selectProject } from '@/lib/projects.ts';
import { listTaskActions, TASK_ACTION } from '@/lib/tasks/actions.ts';
import type { RoadmapGroupKey } from '@/lib/tasks/roadmap.ts';
import { describeTaskSteps, resolveShapeIcon, resolveShapeLabel } from '@/lib/tasks/shapes.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, resolveTaskPath } from '@/router.ts';
import { PullRequestBadge } from './pull-request-badge.tsx';
import { ChainArrow, WaitsOnLinks } from './waits-on.tsx';

export const ROADMAP_COLUMNS =
  'grid-cols-[minmax(0,1fr)_7.5rem_12rem_4.5rem_4.5rem] max-md:grid-cols-[minmax(0,1fr)_auto]';

export const ROADMAP_ROW_HEIGHT = 36;

export const FILED_COLUMNS =
  'grid-cols-[minmax(0,1fr)_10rem_4.5rem_4.5rem] max-md:grid-cols-[minmax(0,1fr)_auto]';

const DEPTH_INDENT = ['', '', 'ps-6.5', 'ps-13'];

function TaskMenuItems({ state, task }: { state: ShinsaState; task: Task }) {
  return (
    <DropdownMenuContent className='min-w-48'>
      <DropdownMenuItem icon={TASK_ACTION.open.icon} onClick={() => navigate(resolveTaskPath(task))}>
        {TASK_ACTION.open.label}
      </DropdownMenuItem>
      {!isTaskSettled(task) && (
        <>
          <DropdownMenuSeparator />
          <PriorityChoices task={task} />
          <DropdownMenuSeparator />
          <DependencyItems state={state} task={task} />
        </>
      )}
      {listTaskActions(task).length > 0 && <DropdownMenuSeparator />}
      <TaskActionItems task={task} />
    </DropdownMenuContent>
  );
}

function KindMark({ state, task }: { state: ShinsaState; task: Task }) {
  return (
    <Hint label={describeTaskSteps(task)}>
      <span
        role='img'
        aria-label={resolveShapeLabel(task)}
        className={cn(
          'grid size-4 shrink-0 place-items-center',
          TONE_TEXT[resolveTaskStatus(state, task).tone]
        )}
      >
        <Icon size='sm' name={resolveShapeIcon(task)} />
      </span>
    </Hint>
  );
}

function RepoMark({ state, repo }: { state: ShinsaState; repo: Repo }) {
  const project = selectProject(state, repo.projectId);
  const icon = <RepoIcon state={state} repo={repo} />;
  if (!project) return icon;
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          {project.name} <TooltipLabel>project</TooltipLabel>
        </span>
      }
    >
      <span className='inline-flex shrink-0'>{icon}</span>
    </Hint>
  );
}

function RowStatus({ state, task, group }: { state: ShinsaState; task: Task; group: RoadmapGroupKey }) {
  if (group === 'waiting') return <WaitsOnLinks waitsOn={listWaitsOn(state, task)} />;
  return <StatusText state={state} task={task} className='truncate text-xs' />;
}

export const RoadmapRow = React.memo(function RoadmapRowItem({
  state,
  task,
  group,
  depth,
  columns = ROADMAP_COLUMNS,
}: {
  state: ShinsaState;
  task: Task;
  group: RoadmapGroupKey;
  depth: number;
  columns?: string;
}) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const level = Math.min(depth, 3);
  return (
    <LazyMenu kind='context' content={<TaskMenuItems state={state} task={task} />}>
      <LazyMenuTrigger
        render={
          // biome-ignore lint/a11y/useSemanticElements: the row holds a pull request link, so it cannot be a button
          <div
            role='button'
            tabIndex={0}
            data-depth={level}
            onClick={(event) => {
              if (event.currentTarget.contains(event.target as Node)) navigate(resolveTaskPath(task));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target === event.currentTarget) {
                navigate(resolveTaskPath(task));
              }
            }}
            className={`grid h-9 w-full cursor-pointer items-center gap-4 border-border border-b px-3 text-left text-xs outline-none hover:not-has-[a:hover,button:hover]:bg-bg-a1 active:not-has-[a:active,button:active]:bg-bg-a1 data-popup-open:bg-bg-a1 ${columns}`}
          />
        }
      >
        <span className={cn('flex min-w-0 items-center gap-1.5', DEPTH_INDENT[level])}>
          {depth > 0 && <ChainArrow state={state} task={task} />}
          <Hint label={`${PRIORITY_LABEL[task.priority]} priority`}>
            <span className='grid size-4 shrink-0 place-items-center'>
              <PriorityIcon priority={task.priority} />
            </span>
          </Hint>
          <TaskHandle task={task} />
          <Truncate className='text-fg-4'>{task.title}</Truncate>
        </span>
        {columns === ROADMAP_COLUMNS && (
          <span className='flex min-w-0 items-center gap-1.5 text-fg-2 max-md:hidden'>
            {repo && <RepoMark state={state} repo={repo} />}
            <Truncate>{repo?.name ?? 'No repository'}</Truncate>
          </span>
        )}
        <span className='flex min-w-0 items-center gap-1.5 max-md:hidden'>
          <KindMark state={state} task={task} />
          <RowStatus state={state} task={task} group={group} />
        </span>
        <span className='max-md:hidden'>
          <PullRequestBadge task={task} />
        </span>
        <span className='text-right text-2xs text-fg-2'>
          <TimeAgo at={task.updatedAt} />
        </span>
      </LazyMenuTrigger>
    </LazyMenu>
  );
});
