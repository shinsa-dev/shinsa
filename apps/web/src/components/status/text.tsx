import type { ShinsaState, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
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

export function ToneLabel({
  label,
  tone,
  shrinks = false,
}: {
  label: string;
  tone: Tone;
  shrinks?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-2xs font-medium',
        shrinks ? 'min-w-0' : 'shrink-0',
        TONE_TEXT[tone]
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', TONE_FILL[tone])} />
      {shrinks ? <Truncate>{label}</Truncate> : label}
    </span>
  );
}
