import type { ShinsaState } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { TaskLink } from '@/components/links/task.tsx';
import type { BreakdownRow, TaskRow } from '@/lib/stats/usage.ts';
import { TOKEN_TEXT } from '../group.tsx';
import { STAT_PANEL } from './stat-tile.tsx';

const LIST_ROW = 'flex min-h-8 items-center gap-3 px-3 py-1';

const EMPTY_ROW = cn(LIST_ROW, 'text-fg-2 text-xs');

function ListPanel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(STAT_PANEL, 'flex min-w-0 flex-col')}>
      <div className='flex h-9 shrink-0 items-center gap-3 px-3'>
        <Truncate className='flex-1 font-medium text-fg-4 text-xs'>{title}</Truncate>
        {aside}
      </div>
      <div className='flex flex-col divide-y divide-border border-border border-t'>{children}</div>
    </div>
  );
}

function TaskTitle({ state, taskId, title }: { state: ShinsaState; taskId: string; title: string }) {
  const task = state.tasks[taskId];
  if (!task) return <Truncate className='flex-1 text-fg-4 text-xs'>{title}</Truncate>;
  return (
    <span className='min-w-0 flex-1 truncate text-fg-4 text-xs'>
      <TaskLink state={state} task={task} />
    </span>
  );
}

export function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <ListPanel title={title}>
      {rows.length === 0 && <span className={EMPTY_ROW}>No agent runs</span>}
      {rows.map((row) => (
        <div key={row.key} className='flex flex-col gap-1.5 px-3 py-2'>
          <div className='flex items-baseline gap-2'>
            <Truncate className='flex-1 text-fg-4 text-xs'>{row.label}</Truncate>
            <span className={TOKEN_TEXT}>{row.tokens}</span>
          </div>
          <div className='h-1 overflow-hidden rounded-full bg-bg-a2'>
            <div className='h-full rounded-full bg-primary-4' style={{ width: `${row.share * 100}%` }} />
          </div>
        </div>
      ))}
    </ListPanel>
  );
}

export function TopTasks({ state, rows }: { state: ShinsaState; rows: TaskRow[] }) {
  return (
    <ListPanel
      title='Tasks that used the most tokens'
      aside={
        <span className='flex shrink-0 items-center gap-3 text-2xs text-fg-2'>
          <span className='w-12 text-right'>Tokens</span>
          <span className='w-12 text-right'>Cached</span>
          <span className='w-14 text-right'>Cost</span>
        </span>
      }
    >
      {rows.length === 0 && <span className={EMPTY_ROW}>No agent runs</span>}
      {rows.map((row) => (
        <div key={row.taskId} className={LIST_ROW}>
          <TaskTitle state={state} taskId={row.taskId} title={row.title} />
          <span className={cn(TOKEN_TEXT, 'w-12 text-right')}>{row.tokens}</span>
          <span className={cn(TOKEN_TEXT, 'w-12 text-right')}>{row.cacheHit}</span>
          <span className={cn(TOKEN_TEXT, 'w-14 text-right')}>{row.cost}</span>
        </div>
      ))}
    </ListPanel>
  );
}
