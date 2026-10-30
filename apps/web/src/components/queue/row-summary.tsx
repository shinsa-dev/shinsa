import {
  listActiveRuns,
  type Run,
  resolveShapeState,
  resolveTaskProgress,
  type ShinsaState,
  selectLeadGate,
  type Task,
} from '@shinsa/core';
import { ShimmeringText } from '@shinsa/ui/components/shimmering-text';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { MiniTrack } from '@/components/overview/mini-track.tsx';
import { TaskHandlePrefix } from '@/components/task/handle.tsx';
import { describeParkedRun } from '@/lib/chat/delegations.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveLatestActivity } from '@/lib/overview/now.ts';
import {
  describeStepCount,
  resolveSteps,
  SHAPING_LABEL,
  selectCurrentStep,
} from '@/lib/overview/progress.ts';
import { resolveRowStatus } from '@/lib/tasks/status.ts';

function LiveActivity({ run, fallback }: { run: Run; fallback: string | null }) {
  const text = resolveLatestActivity(useTranscript(run.id)) ?? fallback;
  if (!text) return null;
  if (describeParkedRun(run)) return <Truncate>{text}</Truncate>;
  return (
    <Truncate key={text} tooltip={text} className='leading-normal'>
      <ShimmeringText text={text} className='inline leading-normal' />
    </Truncate>
  );
}

function resolveRowProgress(task: Task, status: string) {
  if (resolveShapeState(task) !== 'settled') return { track: <Spinner size='sm' />, note: SHAPING_LABEL };
  const steps = resolveSteps(resolveTaskProgress(task));
  return { track: <MiniTrack steps={steps} />, note: describeStepCount(selectCurrentStep(steps), status) };
}

export function RowSummary({
  state,
  task,
  activity = true,
}: {
  state: ShinsaState;
  task: Task;
  activity?: boolean;
}) {
  const [run] = !activity || selectLeadGate(state, task) ? [] : listActiveRuns(state, task.id);
  const status = resolveRowStatus(state, task);
  const { track, note } = resolveRowProgress(task, status.label);
  return (
    <span className='flex min-w-0 flex-1 items-center gap-2'>
      <span className='shrink-0'>
        <TaskHandlePrefix task={task} />
        <span className={cn('font-medium', TONE_TEXT[status.tone])}>{status.label}</span>
      </span>
      {track}
      <span className='flex min-w-0 flex-1 contain-inline-size'>
        {run ? <LiveActivity run={run} fallback={note} /> : note && <Truncate>{note}</Truncate>}
      </span>
    </span>
  );
}
