import { Effect } from 'effect';
import * as React from 'react';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { StatusText } from '@/components/status/text.tsx';
import { PullRequestBadge } from '@/components/tasks/pull-request-badge.tsx';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { createLoopState, LOOP_ENTRIES } from '../../lib/loop-scene.ts';
import { FIRST_STEP_MS, useFocus } from './focus.ts';
import { DemoRoot, Stage } from './frame.tsx';

const STEP_MS = 1600;

export function LoopDemo() {
  const [now] = React.useState(Date.now);
  const [shown, setShown] = React.useState(1);
  const { ref, focused } = useFocus<HTMLDivElement>();
  const started = React.useRef(false);
  const { state, task } = React.useMemo(() => createLoopState(now, shown), [now, shown]);

  useAppEffect(() => {
    if (!focused) return Effect.void;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      return Effect.sync(() => setShown(LOOP_ENTRIES.length));
    const last = shown >= LOOP_ENTRIES.length;
    const delay = started.current ? STEP_MS : FIRST_STEP_MS;
    return Effect.sync(() => {
      started.current = true;
      setShown(last ? 1 : shown + 1);
    }).pipe(Effect.delay(last ? STEP_MS * 3 : delay));
  }, [focused, shown]);

  const entries = [...task.activity].reverse();
  return (
    <DemoRoot>
      <Stage className='demo-static flex h-full justify-center'>
        <div ref={ref} className='flex w-full max-w-xl flex-col gap-5'>
          <div className='flex h-6 shrink-0 items-center gap-3'>
            <span className='min-w-0 truncate text-sm font-medium text-fg-4'>{task.title}</span>
            <StatusText state={state} task={task} className='shrink-0 text-xs max-sm:hidden' />
            <span className='ms-auto'>
              <PullRequestBadge task={task} />
            </span>
          </div>
          <ol className='flex h-[420px] flex-col overflow-hidden mask-b-from-85%'>
            {entries.map((entry) => (
              <ActivityRow key={entry.text} entry={entry} state={state} onOpenRun={() => undefined} />
            ))}
          </ol>
          <p className='h-10 shrink-0 border-t border-bg-3 pt-4 text-center text-sm text-fg-2'>
            Asked of you so far: one review. The merge is next.
          </p>
        </div>
      </Stage>
    </DemoRoot>
  );
}
