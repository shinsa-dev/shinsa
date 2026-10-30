import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Pulse } from '@/components/status/pulse.tsx';
import { describeTrackPosition, isStepReached, type Step, type StepStatus } from '@/lib/overview/progress.ts';

const MINI_DOT: Record<Exclude<StepStatus, 'current'>, string> = {
  done: 'bg-green-4',
  skipped: 'border border-dashed border-fg-2',
  waiting: 'bg-amber-4',
  pending: 'border border-bg-a3',
  cancelled: 'border border-fg-2',
};

function MiniDot({ status }: { status: StepStatus }) {
  if (status === 'current') return <Pulse tone='blue' />;
  return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', MINI_DOT[status])} />;
}

export function MiniTrack({ steps }: { steps: Step[] }) {
  return (
    <span role='img' aria-label={describeTrackPosition(steps)} className='flex shrink-0 items-center'>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          {index > 0 && (
            <span
              aria-hidden
              className={cn('h-px w-2 shrink-0', isStepReached(step) ? 'bg-green-4' : 'bg-bg-a3')}
            />
          )}
          <MiniDot status={step.status} />
        </React.Fragment>
      ))}
    </span>
  );
}
