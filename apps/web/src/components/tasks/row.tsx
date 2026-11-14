import { isTaskSettled, type Project, type Repo, type Task } from '@shinsa/core';
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
import { InitiativeItems } from '@/components/initiatives/task-items.tsx';
import { RepoGlyph } from '@/components/links/repo.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { SharedMark } from '@/components/share/shared-mark.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { PriorityChoices, TaskActionItems } from '@/components/task/action-items.tsx';
import { DependencyItems } from '@/components/task/dependency-items.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useEngineCommands, useMachine } from '@/lib/connection/socket.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { resolveMachineLabel } from '@/lib/remote/mode.ts';
import { listTaskActions, TASK_ACTION } from '@/lib/tasks/actions.ts';
import { isSameTaskRowModel, type TaskRowModel } from '@/lib/tasks/row-model.ts';
import { describeTaskSteps, resolveShapeIcon, resolveShapeLabel } from '@/lib/tasks/shapes.ts';
import { navigate, resolveTaskPath } from '@/router.ts';
import { TaskOwnerMark } from './owner.tsx';
import { PullRequestBadge } from './pull-request-badge.tsx';
import { useTaskRowState } from './row-state.tsx';
import { ChainArrow, WaitsOnLinks } from './waits-on.tsx';

export const TASK_LIST_COLUMNS =
  'grid-cols-[minmax(0,1fr)_7rem_9.5rem_4rem_3rem] max-md:grid-cols-[minmax(0,1fr)_auto]';

export const TEAM_TASK_LIST_COLUMNS =
  'grid-cols-[minmax(0,1fr)_6.5rem_5rem_9.5rem_4rem_3rem] max-md:grid-cols-[minmax(0,1fr)_auto]';

export const TASK_LIST_ROW_HEIGHT = 36;

export const TASK_LIST_ROW =
  'grid h-9 w-full cursor-pointer items-center gap-3 border-border border-b px-3 text-left text-xs outline-none hover:not-has-[a:hover,button:hover]:bg-bg-a1 active:not-has-[a:active,button:active]:bg-bg-a1 data-popup-open:bg-bg-a1';

export const FILED_COLUMNS =
  'grid-cols-[minmax(0,1fr)_9.5rem_4rem_3rem] max-md:grid-cols-[minmax(0,1fr)_auto]';

const DEPTH_INDENT = ['', '', 'ps-4', 'ps-8', 'ps-12', 'ps-16', 'ps-20'];

const DEEPEST_INDENT = DEPTH_INDENT.length - 1;

export function resolveDepthIndent(depth: number) {
  return DEPTH_INDENT[Math.min(depth, DEEPEST_INDENT)];
}

export function describeChainDepth(depth: number) {
  return depth > DEEPEST_INDENT ? `${depth} steps down the chain` : null;
}

export function DepthMark({ depth }: { depth: number }) {
  const label = describeChainDepth(depth);
  if (!label) return null;
  return (
    <Hint label={label}>
      <span className='shrink-0 text-2xs text-fg-2 tabular-nums'>{depth}</span>
    </Hint>
  );
}

function TaskMenuItems({ task }: { task: Task }) {
  const state = useTaskRowState();
  const commands = useEngineCommands(task.id);
  const teammate = useMachine(task.id)?.teammate ?? null;
  if (!state) return null;
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
      <InitiativeItems state={state} task={task} />
      {listTaskActions(task, commands, Date.now(), teammate).length > 0 && <DropdownMenuSeparator />}
      <TaskActionItems state={state} task={task} />
    </DropdownMenuContent>
  );
}

export function KindMark({ task, tone }: { task: Task; tone: Tone }) {
  return (
    <Hint label={describeTaskSteps(task)}>
      <span
        role='img'
        aria-label={resolveShapeLabel(task)}
        className={cn('grid size-4 shrink-0 place-items-center', TONE_TEXT[tone])}
      >
        <Icon size='sm' name={resolveShapeIcon(task)} />
      </span>
    </Hint>
  );
}

export function RepoMark({ repo, project }: { repo: Repo; project: Project | null }) {
  const machine = useMachine(repo.id);
  const icon = <RepoGlyph repo={repo} project={project} />;
  if (!(project || machine)) return icon;
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          {project && (
            <>
              {project.name} <TooltipLabel>project</TooltipLabel>
            </>
          )}
          {project && machine && ' '}
          {machine && (
            <>
              {resolveMachineLabel(machine)} <TooltipLabel>machine</TooltipLabel>
            </>
          )}
        </span>
      }
    >
      <span className='inline-flex shrink-0'>{icon}</span>
    </Hint>
  );
}

export function RowStatus({ model }: { model: TaskRowModel }) {
  if (model.waitsOn.length > 0) return <WaitsOnLinks waitsOn={model.waitsOn} stacked={model.stacked} />;
  return (
    <span className={cn('truncate text-xs font-medium', TONE_TEXT[model.status.tone])}>
      {model.status.label}
    </span>
  );
}

function isSameRow(
  left: { model: TaskRowModel; columns?: string },
  right: { model: TaskRowModel; columns?: string }
) {
  return left.columns === right.columns && isSameTaskRowModel(left.model, right.model);
}

export const TaskListRow = React.memo(function TaskListRowItem({
  model,
  columns = TASK_LIST_COLUMNS,
}: {
  model: TaskRowModel;
  columns?: string;
}) {
  const { task, depth, repo } = model;
  return (
    <LazyMenu kind='context' content={<TaskMenuItems task={task} />}>
      <LazyMenuTrigger
        render={
          // oxlint-disable-next-line shinsa/use-semantic-elements -- the row holds a pull request link, so it cannot be a button
          <div
            role='button'
            tabIndex={0}
            data-depth={depth}
            onClick={(event) => {
              if (event.currentTarget.contains(event.target as Node)) navigate(resolveTaskPath(task));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.target === event.currentTarget) {
                navigate(resolveTaskPath(task));
              }
            }}
            className={`${TASK_LIST_ROW} ${columns}`}
          />
        }
      >
        <span className={cn('flex min-w-0 items-center gap-1.5', resolveDepthIndent(depth))}>
          {depth > 0 && <ChainArrow task={task} parents={model.stackParents} others={model.chainOthers} />}
          <DepthMark depth={depth} />
          <Hint label={`${PRIORITY_LABEL[task.priority]} priority`}>
            <span className='grid size-4 shrink-0 place-items-center'>
              <PriorityIcon priority={task.priority} />
            </span>
          </Hint>
          <TaskHandle task={task} />
          <Truncate className='text-fg-4'>{task.title}</Truncate>
          <SharedMark task={task} />
        </span>
        {columns !== FILED_COLUMNS && (
          <span className='flex min-w-0 items-center gap-1.5 text-fg-2 max-md:hidden'>
            {repo && <RepoMark repo={repo} project={model.project} />}
            <Truncate>{repo?.name ?? 'No repository'}</Truncate>
          </span>
        )}
        {columns === TEAM_TASK_LIST_COLUMNS && (
          <span className='flex min-w-0 max-md:hidden'>
            <TaskOwnerMark task={task} />
          </span>
        )}
        <span className='flex min-w-0 items-center gap-1.5 max-md:hidden'>
          <KindMark task={task} tone={model.status.tone} />
          <RowStatus model={model} />
        </span>
        <span className='max-md:hidden'>
          <PullRequestBadge task={task} />
        </span>
        <span className='text-right text-2xs text-fg-2'>
          <TimeAgo at={task.updatedAt} compact />
        </span>
      </LazyMenuTrigger>
    </LazyMenu>
  );
}, isSameRow);
