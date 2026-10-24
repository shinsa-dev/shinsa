import type { Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { resolveHandleText } from '@/lib/tasks/rounds.ts';

export function TaskHandle({ task, className }: { task: Task; className?: string }) {
  const text = resolveHandleText(task);
  if (!text) return null;
  return <span className={cn('shrink-0 text-2xs text-fg-2 tabular-nums', className)}>{text}</span>;
}

export function TaskHandlePrefix({ task }: { task: Task }) {
  const text = resolveHandleText(task);
  if (!text) return null;
  return <span className='tabular-nums'>{text} · </span>;
}
