import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { GuardedCommand } from '../../lib/guard.ts';
import { FIRST_STEP_MS, useFocus } from './focus.ts';
import { Stage } from './frame.tsx';

const STEP_MS = 1300;

export function GuardDemo({ commands }: { commands: GuardedCommand[] }) {
  const [shown, setShown] = React.useState(1);
  const { ref, focused } = useFocus<HTMLDivElement>();
  const started = React.useRef(false);

  React.useEffect(() => {
    if (!focused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(commands.length);
      return;
    }
    const last = shown >= commands.length;
    const delay = started.current ? STEP_MS : FIRST_STEP_MS;
    const timer = setTimeout(
      () => {
        started.current = true;
        setShown(last ? 1 : shown + 1);
      },
      last ? STEP_MS * 4 : delay
    );
    return () => clearTimeout(timer);
  }, [focused, shown, commands.length]);

  return (
    <Stage className='demo-static flex h-full justify-center'>
      <div
        ref={ref}
        className='corner-superellipse/1.125 flex h-[460px] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-2xl bg-background p-5 font-mono text-xs ring-1 ring-bg-3 max-sm:p-4'
      >
        <span className='shrink-0 font-sans text-2xs text-fg-2'>
          Commands the agent ran on NW-155, checked before each one runs
        </span>
        <div className='mask-t-from-85% flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden'>
          {commands.slice(0, shown).map((entry) => (
            <div key={entry.command} className='flex shrink-0 flex-col gap-1'>
              <span className='flex items-start gap-2 text-fg-4 max-sm:flex-wrap'>
                <span className='text-fg-1'>$</span>
                <span className='min-w-0 flex-1 sm:whitespace-nowrap'>{entry.command}</span>
                <span
                  className={cn(
                    'flex shrink-0 items-center gap-1 font-sans text-2xs max-sm:basis-full max-sm:ps-4',
                    entry.refusal ? 'text-destructive' : 'text-fg-2'
                  )}
                >
                  <Icon name={entry.refusal ? 'IconShieldCheck' : 'IconCheckmark1Small'} />
                  {entry.refusal ? 'Refused' : 'Ran'}
                </span>
              </span>
              {entry.refusal && <span className='ps-4 font-sans text-2xs text-fg-2'>{entry.refusal}</span>}
            </div>
          ))}
        </div>
      </div>
    </Stage>
  );
}
