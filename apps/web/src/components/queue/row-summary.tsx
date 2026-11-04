import {
  type Gate,
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
  describeStatusCount,
  resolveSteps,
  SHAPING_LABEL,
  selectCurrentStep,
} from '@/lib/overview/progress.ts';
import { describeBundleWait } from '@/lib/tasks/groups.ts';
import { resolveRowStatus, resolveStageLabel } from '@/lib/tasks/status.ts';

function LiveActivity({ run, fallback }: { run: Run; fallback: string | null }) {
  const text = resolveLatestActivity(useTranscript(run.id)) ?? fallback;
  if (!text) return null;
  if (describeParkedRun(run)) return <Truncate>{text}</Truncate>;
  return (
    <Truncate key={text} tooltip={text} className='relative leading-normal'>
      <ShimmeringText text={text} className='static inline leading-normal' />
    </Truncate>
  );
}

function resolveRowProgress(task: Task, status: string) {
  if (resolveShapeState(task) !== 'settled') {
    return { track: <Spinner size='sm' />, note: SHAPING_LABEL, count: null };
  }
  const steps = resolveSteps(resolveTaskProgress(task));
  return {
    track: <MiniTrack steps={steps} />,
    note: null,
    count: describeStatusCount(selectCurrentStep(steps), status, resolveStageLabel(task)),
  };
}

const POST_MERGE_PROGRESS = { track: null, note: null, count: null };

export function RowSummary({
  state,
  task,
  gate = null,
  detail,
}: {
  state: ShinsaState;
  task: Task;
  gate?: Gate | null;
  detail: boolean;
}) {
  const postMerge = gate?.type === 'post_merge';
  const quiet = !postMerge && (gate !== null || selectLeadGate(state, task) !== null);
  const [run] = quiet ? [] : listActiveRuns(state, task.id);
  const status = resolveRowStatus(state, task, gate);
  const progress = postMerge ? POST_MERGE_PROGRESS : resolveRowProgress(task, status.label);
  const { track, count } = progress;
  const note =
    progress.note ?? describeBundleWait(state, task) ?? (postMerge && run ? resolveStageLabel(task) : null);
  return (
    <span className='flex min-w-0 flex-1 items-center gap-2'>
      <span className='shrink-0'>
        <TaskHandlePrefix task={task} round={!postMerge} />
        <span className={cn('font-medium', TONE_TEXT[status.tone])}>{status.label}</span>
        {count && (
          <>
            {' '}
            <span className='text-fg-2 tabular-nums'>{count}</span>
          </>
        )}
      </span>
      {track}
      {detail && (
        <span className='flex min-w-0 flex-1 contain-inline-size'>
          {run ? <LiveActivity run={run} fallback={note} /> : note && <Truncate>{note}</Truncate>}
        </span>
      )}
    </span>
  );
}
