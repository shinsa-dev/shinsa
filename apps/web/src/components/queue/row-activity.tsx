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
import { SHIMMER_LINE } from '@/components/chat/chat-line.tsx';
import { MiniTrack } from '@/components/overview/mini-track.tsx';
import { describeParkedRun } from '@/lib/chat/delegations.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { resolveLatestActivity } from '@/lib/overview/now.ts';
import { describeStep, resolveSteps, SHAPING_LABEL, selectCurrentStep } from '@/lib/overview/progress.ts';

function LiveActivity({ run, fallback }: { run: Run; fallback: string }) {
  const text = resolveLatestActivity(useTranscript(run.id)) ?? fallback;
  if (describeParkedRun(run)) return <Truncate>{text}</Truncate>;
  return <ShimmeringText key={text} text={text} className={cn(SHIMMER_LINE, 'min-w-0')} />;
}

export function RowActivity({ state, task }: { state: ShinsaState; task: Task }) {
  if (resolveShapeState(task) !== 'settled') {
    return (
      <span className='flex items-center gap-1.5'>
        <Spinner size='sm' />
        {SHAPING_LABEL}
      </span>
    );
  }
  const steps = resolveSteps(resolveTaskProgress(task));
  const current = selectCurrentStep(steps);
  const [run] = selectLeadGate(state, task) ? [] : listActiveRuns(state, task.id);
  const step = current ? describeStep(current) : '';
  return (
    <span className='flex min-w-0 items-center gap-2'>
      <MiniTrack steps={steps} />
      {run ? <LiveActivity run={run} fallback={step} /> : step && <Truncate>{step}</Truncate>}
    </span>
  );
}
