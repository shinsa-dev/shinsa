import type { ShinsaState, Task } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { TONE_FILL, TONE_TEXT, type Tone } from '@/lib/format/tone.ts';
import { resolveTaskNow } from '@/lib/tasks/now.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';

export function StatusText({
  state,
  task,
  className,
}: {
  state: ShinsaState;
  task: Task;
  className?: string;
}) {
  const status = resolveTaskStatus(state, task);
  return <span className={cn('font-medium', TONE_TEXT[status.tone], className)}>{status.label}</span>;
}

export function TaskMeta({ state, task }: { state: ShinsaState; task: Task }) {
  const now = resolveTaskNow(state, task);
  const repeats = now.toLowerCase() === resolveTaskStatus(state, task).label.toLowerCase();
  return (
    <>
      <StatusText state={state} task={task} />
      {now && !repeats && <> · {now}</>}
    </>
  );
}

export function ToneLabel({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 font-medium text-2xs', TONE_TEXT[tone])}>
      <span className={cn('size-1.5 rounded-full', TONE_FILL[tone])} />
      {label}
    </span>
  );
}
