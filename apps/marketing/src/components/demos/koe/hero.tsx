import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Kbd } from '@shinsa/ui/components/kbd';
import { cn } from '@shinsa/ui/lib/utils';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { KOE_BUNDLE, KOE_STEPS, type KoeStep } from '../../../lib/koe-scene.ts';
import { FIRST_STEP_MS, useFocus } from '../focus.ts';
import { DemoRoot } from '../frame.tsx';
import { KoePillView } from './pill.tsx';

const REDUCED_STEP = 7;

function Cursor({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox='0 0 16 22' className={cn('absolute h-5.5 w-4 drop-shadow-sm', className)}>
      <path d='M1 1 L1 17 L5 13 L8 20 L11 19 L8 12 L14 12 Z' fill='black' stroke='white' strokeWidth='1.2' />
    </svg>
  );
}

function Lights() {
  return (
    <span className='flex gap-1.5'>
      <span className='size-2.5 rounded-full bg-red-4' />
      <span className='size-2.5 rounded-full bg-yellow-4' />
      <span className='size-2.5 rounded-full bg-green-4' />
    </span>
  );
}

function SettingsPage({ step }: { step: KoeStep }) {
  return (
    <div className='flex min-h-0 flex-1'>
      <nav className='flex w-36 shrink-0 flex-col gap-0.5 border-e border-bg-3 p-3 text-sm max-sm:hidden'>
        {['General', 'Members', 'Billing', 'Integrations'].map((item, index) => (
          <span
            key={item}
            className={cn('rounded-control px-2 py-1 text-fg-2', index === 0 && 'bg-bg-a2 text-fg-4')}
          >
            {item}
          </span>
        ))}
      </nav>
      <div className='flex min-w-0 flex-1 flex-col gap-4 p-6'>
        <div className='flex flex-col gap-0.5'>
          <span className='text-lg font-medium text-fg-4'>Workspace</span>
          <span className='text-sm text-fg-2'>How your team sees Northwind.</span>
        </div>
        <div className='relative max-w-md'>
          <div className='flex flex-col gap-4 rounded-xl border border-bg-3 bg-background p-4'>
            <div className='flex flex-col gap-1.5 text-sm text-fg-3'>
              Name
              <Input aria-label='Name' value='Northwind Studio' readOnly tabIndex={-1} />
            </div>
            <div className='flex flex-col gap-1.5 text-sm text-fg-3'>
              Address
              <Input aria-label='Address' value='northwind.app/studio' readOnly tabIndex={-1} />
            </div>
            <div className='relative flex justify-end'>
              <Button variant='secondary' tabIndex={-1} className='pointer-events-none'>
                Save
              </Button>
              {step.pin && (
                <span className='koe-swap absolute -top-2.5 -right-2.5 grid size-5 place-items-center rounded-full bg-primary-4 text-[11px] font-medium text-white shadow-md ring-2 ring-background'>
                  1
                </span>
              )}
            </div>
          </div>
          {step.selection !== 'none' && (
            <div
              className={cn(
                'absolute -inset-2 rounded-2xl border-2 border-primary-4 bg-primary-a1',
                step.selection === 'drawing' && 'koe-draw'
              )}
            />
          )}
          {step.pointer === 'field' && <Cursor className='koe-swap right-4 bottom-2' />}
          {step.pointer === 'button' && <Cursor className='koe-swap right-6 bottom-1' />}
        </div>
      </div>
    </div>
  );
}

function Thumbnail({ pinned }: { pinned: boolean }) {
  return (
    <span className='relative flex h-14 w-20 shrink-0 flex-col gap-1 rounded-lg border border-bg-3 bg-background p-1.5'>
      <span className='h-1.5 w-8 rounded-full bg-bg-3' />
      <span className='h-2.5 rounded-sm border border-bg-3' />
      <span className='h-2.5 rounded-sm border border-bg-3' />
      <span className='ms-auto h-2.5 w-6 rounded-sm bg-bg-3' />
      {pinned && <span className='absolute right-1 bottom-1 size-2 rounded-full bg-primary-4' />}
    </span>
  );
}

function PastedChat() {
  return (
    <div className='koe-swap flex min-h-0 flex-1 flex-col items-center justify-end gap-4 p-6'>
      <span className='flex items-center gap-2 text-sm text-fg-2'>
        <Icon name='IconBubbleText' />
        What should we work on?
      </span>
      <div className='flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-bg-3 bg-background p-3 shadow-sm'>
        <div className='flex gap-2'>
          <Thumbnail pinned={false} />
          <Thumbnail pinned />
        </div>
        <p className='text-sm leading-relaxed text-fg-4'>
          {KOE_BUNDLE.map((part) =>
            'text' in part ? (
              <span key={part.text}>{part.text} </span>
            ) : (
              <span key={part.marker}>
                <strong className='font-medium'>
                  [{part.marker}: {part.note}]
                </strong>{' '}
              </span>
            )
          )}
        </p>
        <div className='flex items-center justify-between text-xs text-fg-2'>
          <span>2 images</span>
          <span className='grid size-7 place-items-center rounded-full bg-primary-4 text-white'>
            <Icon name='IconArrowUp' />
          </span>
        </div>
      </div>
    </div>
  );
}

function Caption({ said }: { said: string }) {
  return (
    <div className='flex h-8 items-center justify-center'>
      {said && (
        <span
          key={said}
          className='koe-swap flex items-center gap-2 rounded-full bg-background/80 px-3 py-1 text-sm text-fg-3 shadow-sm ring-1 ring-bg-3 backdrop-blur [--icon-size:14px]'
        >
          <span className='text-primary-4'>
            <Icon name='IconMicrophone' />
          </span>
          “{said}”
        </span>
      )}
    </div>
  );
}

export function KoeHeroDemo() {
  const [index, setIndex] = React.useState(0);
  const { ref, focused } = useFocus<HTMLDivElement>();
  const started = React.useRef(false);
  const step = KOE_STEPS[index] ?? KOE_STEPS[0]!;

  useAppEffect(() => {
    if (!focused) return Effect.void;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return Effect.sync(() => setIndex(REDUCED_STEP));
    const delay = started.current ? step.ms : FIRST_STEP_MS;
    return Effect.sync(() => {
      started.current = true;
      setIndex((index + 1) % KOE_STEPS.length);
    }).pipe(Effect.delay(delay));
  }, [focused, index]);

  const picking = step.pill?.kind === 'prompt' && step.pill.stage === 'picking';
  return (
    <DemoRoot>
      <div
        ref={ref}
        className='koe-desktop corner-superellipse/1.125 relative flex h-full flex-col gap-3 overflow-hidden rounded-3xl p-4 ring-1 ring-bg-3 md:p-8'
      >
        <Caption said={step.said} />
        <div className='relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-background shadow-xl ring-1 ring-bg-4/70 dark:ring-bg-3'>
          <div className='relative flex h-9 shrink-0 items-center border-b border-bg-3 px-3'>
            <Lights />
            <span className='absolute inset-x-0 text-center text-xs font-medium text-fg-3'>
              {step.pasted ? 'Agent' : 'Northwind'}
            </span>
          </div>
          {step.pasted ? <PastedChat /> : <SettingsPage step={step} />}
          {picking && <div className='pointer-events-none absolute inset-0 bg-fg-a1' />}
        </div>
        <div className='absolute inset-x-0 bottom-6 flex justify-center md:bottom-10'>
          {step.pill ? (
            <KoePillView pill={step.pill} className='shadow-2xl' />
          ) : (
            !step.pasted && (
              <span className='koe-swap flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-sm text-fg-2 shadow-md ring-1 ring-bg-3'>
                Hold <Kbd>fn</Kbd> and talk
              </span>
            )
          )}
        </div>
      </div>
    </DemoRoot>
  );
}
