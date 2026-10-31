import { resolveShapeState, resolveTaskProgress, type Task, type TaskProgress } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoLine } from '@/components/overlays/info-popover.tsx';
import { CheckMark } from '@/components/status/check-mark.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  isStepReached,
  type LabelFold,
  resolveLabelFold,
  resolveStageNote,
  resolveStepStatusLabel,
  resolveSteps,
  SHAPING_LABEL,
  SHAPING_NOTE,
  STEP_STATUS_LABEL,
  STEP_STATUS_TONE,
  type Step,
  type StepStatus,
} from '@/lib/overview/progress.ts';

function StepMark({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span className='grid size-4 shrink-0 place-items-center rounded-full bg-green-4/29'>
        <CheckMark label={STEP_STATUS_LABEL.done} className='text-green-text' />
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <Icon size='sm' name='IconCircleDotted' ariaLabel={STEP_STATUS_LABEL.skipped} className='text-fg-2' />
    );
  }
  if (status === 'cancelled') {
    return (
      <span className='grid size-4 shrink-0 place-items-center rounded-full bg-bg-a3'>
        <Icon size='sm' name='IconCancelMark' ariaLabel={STEP_STATUS_LABEL.cancelled} className='text-fg-3' />
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span className='grid size-4 shrink-0 place-items-center rounded-full bg-primary-a3'>
        <Pulse tone='blue' />
      </span>
    );
  }
  if (status === 'waiting') {
    return (
      <span className='grid size-4 shrink-0 place-items-center rounded-full bg-amber-a3'>
        <span className='size-1.5 rounded-full bg-amber-4' />
      </span>
    );
  }
  return <span className='size-4 shrink-0 rounded-full border border-bg-a3' />;
}

function StepItem({ step, fold, note }: { step: Step; fold: LabelFold; note: string | null }) {
  const emphasised = step.status === 'current' || step.status === 'waiting' || step.status === 'cancelled';
  return (
    <Tooltip>
      <TooltipTrigger render={<li className='flex w-fit shrink-0 cursor-default items-center gap-1.5' />}>
        <StepMark status={step.status} />
        <span
          className={cn(
            'whitespace-nowrap text-2xs',
            step.status === 'pending' ? 'text-fg-2' : 'text-fg-4',
            emphasised ? 'font-medium' : 'max-sm:hidden',
            fold === 'narrow' && 'max-lg:hidden',
            fold === 'always' && 'hidden'
          )}
        >
          {step.label}
          {step.count && <span className='ms-1 text-fg-2 tabular-nums'>{step.count}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent className='flex-col items-stretch gap-1'>
        <InfoLine
          label={
            <>
              {step.label}
              {step.count && <TooltipLabel> {step.count}</TooltipLabel>}
            </>
          }
          value={
            <span className={TONE_TEXT[STEP_STATUS_TONE[step.status]]}>
              {resolveStepStatusLabel(step, note)}
            </span>
          }
        />
        {step.detail.map((line) => (
          <InfoLine key={line.text} label={line.text} value={line.done && <CheckMark label='Done' />} />
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export function ProgressTrack({ progress, note = null }: { progress: TaskProgress; note?: string | null }) {
  const steps = resolveSteps(progress);
  return (
    <ol aria-label='Progress' className='flex w-full min-w-0 items-center gap-1.5'>
      {steps.map((step, index) => (
        <React.Fragment key={step.key}>
          {index > 0 && (
            <span
              aria-hidden
              className={cn('h-px min-w-2 flex-1', isStepReached(step) ? 'bg-green-4' : 'bg-bg-a3')}
            />
          )}
          <StepItem step={step} fold={resolveLabelFold(step, steps)} note={note} />
        </React.Fragment>
      ))}
    </ol>
  );
}

export function TaskTrack({ task }: { task: Task }) {
  const shaping = resolveShapeState(task);
  if (shaping === 'settled')
    return <ProgressTrack progress={resolveTaskProgress(task)} note={resolveStageNote(task)} />;
  return (
    <ol aria-label='Progress' className='flex self-start'>
      <Hint label={SHAPING_LABEL} detail={SHAPING_NOTE[shaping]}>
        <li className='flex h-4 w-fit cursor-default items-center gap-1.5 text-2xs text-fg-2'>
          <Spinner size='sm' />
          {SHAPING_LABEL}
        </li>
      </Hint>
    </ol>
  );
}
