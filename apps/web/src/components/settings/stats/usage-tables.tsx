import type { ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { TaskLink } from '@/components/links/task.tsx';
import type { BreakdownRow, SavingRow, TaskRow } from '@/lib/stats/usage.ts';
import { ROW_INSET, SETTINGS_SHELF, TOKEN_TEXT } from '../group.tsx';

const LIST_ROW = cn('flex min-h-9 items-center gap-3 py-1', ROW_INSET);

function TaskTitle({ state, taskId, title }: { state: ShinsaState; taskId: string; title: string }) {
  const task = state.tasks[taskId];
  return (
    <span className='min-w-0 flex-1 truncate text-fg-4 text-xs'>
      {task ? <TaskLink state={state} task={task} /> : title}
    </span>
  );
}

export function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <span className='px-2 text-2xs text-fg-2'>{title}</span>
      <div className={SETTINGS_SHELF}>
        {rows.length === 0 && <span className={cn(LIST_ROW, 'text-fg-2 text-xs')}>No agent runs</span>}
        {rows.map((row) => (
          <div key={row.key} className={cn(LIST_ROW, 'flex-col items-stretch gap-1 py-2')}>
            <div className='flex items-baseline gap-2'>
              <span className='min-w-0 flex-1 truncate text-fg-4 text-xs'>{row.label}</span>
              <span className={TOKEN_TEXT}>{row.tokens}</span>
            </div>
            <div className='h-1 overflow-hidden rounded-full bg-bg-a2'>
              <div className='h-full rounded-full bg-primary-4' style={{ width: `${row.share * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TopTasks({ state, rows }: { state: ShinsaState; rows: TaskRow[] }) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <div className='flex items-center gap-3 px-2 text-2xs text-fg-2'>
        <span className='flex-1'>Tasks that used the most tokens</span>
        <span className='w-12 text-right'>Tokens</span>
        <span className='w-12 text-right'>Cached</span>
        <span className='w-14 text-right'>Cost</span>
      </div>
      <div className={SETTINGS_SHELF}>
        {rows.length === 0 && <span className={cn(LIST_ROW, 'text-fg-2 text-xs')}>No agent runs</span>}
        {rows.map((row) => (
          <div key={row.taskId} className={LIST_ROW}>
            <TaskTitle state={state} taskId={row.taskId} title={row.title} />
            <span className={cn(TOKEN_TEXT, 'w-12 text-right')}>{row.tokens}</span>
            <span className={cn(TOKEN_TEXT, 'w-12 text-right')}>{row.cacheHit}</span>
            <span className={cn(TOKEN_TEXT, 'w-14 text-right')}>{row.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Savings({ state, rows }: { state: ShinsaState; rows: SavingRow[] }) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <span className='px-2 text-2xs text-fg-2'>Where tokens could be saved</span>
      <div className={SETTINGS_SHELF}>
        {rows.length === 0 && (
          <span className={cn(LIST_ROW, 'text-fg-2 text-xs')}>Nothing stands out in this range.</span>
        )}
        {rows.map((row) => (
          <div key={row.key} className={cn(LIST_ROW, 'flex-col items-stretch gap-1 py-2')}>
            <div className='flex items-baseline gap-2'>
              <span className='shrink-0 text-fg-4 text-xs'>{row.headline}</span>
              <TaskTitle state={state} taskId={row.taskId} title={row.title} />
            </div>
            <span className='text-2xs text-fg-2'>{row.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
