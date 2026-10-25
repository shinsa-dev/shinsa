import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import type { GuardedCommand } from '../../lib/guard.ts';
import { useFocus } from './focus.ts';
import { Stage } from './frame.tsx';

const STEP_MS = 1300;

export function GuardDemo({ commands }: { commands: GuardedCommand[] }) {
  const [shown, setShown] = React.useState(1);
  const { ref, focused } = useFocus<HTMLDivElement>();

  React.useEffect(() => {
    if (!focused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(commands.length);
      return;
    }
    const last = shown >= commands.length;
    const timer = setTimeout(() => setShown(last ? 1 : shown + 1), last ? STEP_MS * 4 : STEP_MS);
    return () => clearTimeout(timer);
  }, [focused, shown, commands.length]);

  return (
    <Stage className='demo-static flex h-full justify-center'>
      <div
        ref={ref}
        className='corner-superellipse/1.125 flex h-[460px] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-2xl bg-background p-5 font-mono text-xs ring-1 ring-bg-3'
      >
        <span className='font-sans text-2xs text-fg-2'>
          Commands the agent ran on NW-155, checked before each one runs
        </span>
        {commands.slice(0, shown).map((entry) => (
          <div key={entry.command} className='flex flex-col gap-1'>
            <span className='flex items-center gap-2 text-fg-4'>
              <span className='text-fg-1'>$</span>
              {entry.command}
              <span
                className={cn(
                  'ms-auto flex shrink-0 items-center gap-1 font-sans text-2xs',
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
    </Stage>
  );
}
