import type { UserCommand } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Spinner } from '@shinsa/ui/components/spinner';
import * as React from 'react';
import { TaskPage } from '@/routes/task/index.tsx';
import { appendTranscript, onDemoCommand, resetTranscript } from '../../lib/demo-server.ts';
import {
  createGateScene,
  GATE_FEEDS,
  GATE_RUN_ID,
  type GateStep,
  PLAN_FEED,
  PLAN_RUN_ID,
} from '../../lib/gates-scene.ts';
import { DemoRoot, Window } from './frame.tsx';
import { useLiveElements } from './live.ts';

const FEED_STEP_MS = 700;

const TRY_LABEL: Partial<Record<GateStep, string>> = {
  plan: 'approve the plan.',
  question: 'pick an answer and send it.',
  review: 'approve the changes, or keep a finding to send it back.',
  merge: 'merge the pull request.',
};

function listDecisionParts(root: HTMLElement) {
  const card = [...root.querySelectorAll('section')].find((section) => section.querySelector('button'));
  return [card, ...root.querySelectorAll('[role="tablist"], [data-demo-control]')].filter(
    (element) => element !== undefined
  );
}

const AFTER_WORK: Partial<Record<GateStep, GateStep>> = {
  build: 'question',
  finish: 'review',
  fix: 'review',
  ship: 'merge',
};

const WORK_LABEL: Partial<Record<GateStep, string>> = {
  build: 'The agent is building phases 1 and 2.',
  finish: 'The agent builds phase 3. Then the checks and a separate agent review run.',
  fix: 'The agent is fixing the finding you kept.',
  ship: 'Shinsa commits, opens the pull request and waits for CI.',
};

function resolveNext(command: UserCommand): { step: GateStep; fixed?: boolean } | null {
  if (command.type !== 'gate.answer') return null;
  switch (command.gateId) {
    case 'gates-plan':
      return { step: 'build' };
    case 'gates-question':
      return { step: 'finish' };
    case 'gates-review':
      return command.decision === 'revise' ? { step: 'fix', fixed: true } : { step: 'ship' };
    case 'gates-merge':
      return { step: 'merged' };
    default:
      return null;
  }
}

function startTranscripts() {
  resetTranscript(PLAN_RUN_ID);
  resetTranscript(GATE_RUN_ID);
  appendTranscript(PLAN_RUN_ID, PLAN_FEED);
}

function useWork(step: GateStep, onDone: () => void) {
  const done = React.useRef(onDone);
  done.current = onDone;
  React.useEffect(() => {
    const feed = GATE_FEEDS[step];
    if (!feed) return;
    const timers = feed.map((event, index) =>
      setTimeout(() => appendTranscript(GATE_RUN_ID, [event]), (index + 1) * FEED_STEP_MS)
    );
    timers.push(setTimeout(() => done.current(), (feed.length + 2) * FEED_STEP_MS));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [step]);
}

function WorkStatus({ step, onRestart }: { step: GateStep; onRestart: () => void }) {
  const label = WORK_LABEL[step];
  if (label) {
    return (
      <>
        <Spinner size='sm' />
        {label}
      </>
    );
  }
  if (step === 'merged') {
    return (
      <>
        Merged. You made four decisions and nothing else.
        <Button
          data-demo-control
          variant='secondary'
          size='sm'
          icon='IconArrowRotateClockwise'
          onClick={onRestart}
        >
          Start again
        </Button>
      </>
    );
  }
  return (
    <>
      <span className='relative flex size-2'>
        <span className='absolute inset-0 animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden' />
        <span className='relative size-2 rounded-full bg-primary' />
      </span>
      <span className='font-medium text-fg-4'>Try it:</span> {TRY_LABEL[step]}
    </>
  );
}

export function GatesDemo() {
  const [now] = React.useState(Date.now);
  const [step, setStep] = React.useState<GateStep>('plan');
  const [fixed, setFixed] = React.useState(false);
  const scene = React.useMemo(() => createGateScene(now, step, fixed), [now, step, fixed]);
  const ref = useLiveElements<HTMLDivElement>(listDecisionParts);

  React.useEffect(() => {
    startTranscripts();
    return onDemoCommand((command) => {
      const next = resolveNext(command);
      if (!next) return;
      setStep(next.step);
      if (next.fixed) setFixed(true);
    });
  }, []);

  useWork(step, () => {
    const next = AFTER_WORK[step];
    if (next) setStep(next);
  });

  const restart = () => {
    startTranscripts();
    setFixed(false);
    setStep('plan');
  };

  return (
    <DemoRoot>
      <div ref={ref} className='demo-static demo-try flex h-full flex-col items-center gap-4'>
        <p className='flex h-7 shrink-0 items-center justify-center gap-2 text-fg-2 text-sm'>
          <WorkStatus step={step} onRestart={restart} />
        </p>
        <Window title='NW-155 · Split store onboarding into steps' className='min-h-0 w-full flex-1'>
          <div className='flex h-full min-h-0 flex-col'>
            <TaskPage state={scene.state} taskId='NW-155' />
          </div>
        </Window>
      </div>
    </DemoRoot>
  );
}
