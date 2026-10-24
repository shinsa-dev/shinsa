import type { ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { GlyphLabel, INLINE_TILE, InAppLink, SMART_LINK } from '@/components/links/link.tsx';
import { InfoPopover } from '@/components/overlays/info-popover.tsx';
import { TaskMeta } from '@/components/status/text.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  describeWaited,
  resolveTaskAction,
  resolveTaskSince,
  type TaskAction,
} from '@/lib/tasks/next-action.ts';
import { resolveTaskNow } from '@/lib/tasks/now.ts';
import { resolveHandleText } from '@/lib/tasks/rounds.ts';
import { resolveTaskGlyph, resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate } from '@/router.ts';

function TaskPreview({ state, task, action }: { state: ShinsaState; task: Task; action: TaskAction }) {
  const status = resolveTaskStatus(state, task);
  const now = resolveTaskNow(state, task);
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  return (
    <div className='flex flex-col'>
      <div className='flex flex-col gap-2.5 p-3'>
        <div className='flex items-start gap-2'>
          <StatusTile {...resolveTaskGlyph(state, task)} size='sm' className='mt-px' />
          <p className='line-clamp-2 font-medium text-fg-4 text-sm'>{task.title}</p>
        </div>
        <div className='flex flex-col gap-px ps-6 text-xs'>
          <p className={cn('font-medium', TONE_TEXT[status.tone])}>{status.label}</p>
          {now && now.toLowerCase() !== status.label.toLowerCase() && (
            <p className='line-clamp-3 text-fg-3'>{now}</p>
          )}
        </div>
        {(task.handle || repo || task.branch || task.pullRequest) && (
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1 ps-6 text-2xs text-fg-2'>
            {task.handle && <span className='tabular-nums'>{resolveHandleText(task)}</span>}
            {repo && (
              <span className='inline-flex min-w-0 items-center gap-1'>
                <Icon name={repo.remote ? 'IconGithub' : 'IconFolder1'} className='size-3' />
                <span className='truncate'>{repo.name}</span>
              </span>
            )}
            {task.branch && (
              <span className='inline-flex min-w-0 items-center gap-1'>
                <Icon name='IconBranch' className='size-3' />
                <span className='truncate font-mono'>{task.branch}</span>
              </span>
            )}
            {task.pullRequest && (
              <span className='inline-flex items-center gap-1'>
                <Icon name='IconPullRequest' className='size-3' />#{task.pullRequest.number}
              </span>
            )}
          </div>
        )}
      </div>
      <div className='flex items-center justify-between gap-3 border-border border-t px-3 py-2'>
        <span className='text-2xs text-fg-2'>
          <TimeAgo at={resolveTaskSince(state, task)} text={(at) => describeWaited(state, task, at)} />
        </span>
        <Button size='sm' variant='outline' onClick={() => navigate(action.path)}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}

export function TaskLink({ state, task }: { state: ShinsaState; task: Task }) {
  const action = resolveTaskAction(state, task);
  return (
    <InfoPopover
      className='w-80'
      render={<InAppLink path={action.path} className={SMART_LINK} />}
      trigger={
        <GlyphLabel
          glyph={<StatusTile {...resolveTaskGlyph(state, task)} size='sm' className={INLINE_TILE} />}
          text={task.title}
        />
      }
    >
      <TaskPreview state={state} task={task} action={action} />
    </InfoPopover>
  );
}

export function TaskPopoverRows({ state, tasks }: { state: ShinsaState; tasks: Task[] }) {
  return (
    <div className='flex flex-col gap-px'>
      {tasks.map((task) => (
        <button
          key={task.id}
          type='button'
          onClick={() => navigate(resolveTaskAction(state, task).path)}
          className='corner-superellipse/1.125 flex w-full cursor-pointer items-start gap-2 rounded-item px-2 py-1.5 text-left text-xs outline-none hover:bg-bg-a2 active:bg-bg-a2'
        >
          <StatusTile {...resolveTaskGlyph(state, task)} size='sm' className='mt-px' />
          <span className='flex min-w-0 flex-col gap-px'>
            <Truncate className='font-medium text-fg-4'>{task.title}</Truncate>
            <Truncate className='text-2xs text-fg-2'>
              <TaskMeta state={state} task={task} />
            </Truncate>
          </span>
        </button>
      ))}
    </div>
  );
}
