import * as React from 'react';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { PullRequestBadge } from '@/components/roadmap/pull-request-badge.tsx';
import { StatusText } from '@/components/status/text.tsx';
import { createLoopState, LOOP_ENTRIES } from '../../lib/loop-scene.ts';
import { useFocus } from './focus.ts';
import { DemoRoot, Stage } from './frame.tsx';

const STEP_MS = 1600;

export function LoopDemo() {
  const [now] = React.useState(Date.now);
  const [shown, setShown] = React.useState(1);
  const { ref, focused } = useFocus<HTMLDivElement>();
  const { state, task } = React.useMemo(() => createLoopState(now, shown), [now, shown]);

  React.useEffect(() => {
    if (!focused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(LOOP_ENTRIES.length);
      return;
    }
    const last = shown >= LOOP_ENTRIES.length;
    const timer = setTimeout(() => setShown(last ? 1 : shown + 1), last ? STEP_MS * 3 : STEP_MS);
    return () => clearTimeout(timer);
  }, [focused, shown]);

  const entries = [...task.activity].reverse();
  return (
    <DemoRoot>
      <Stage className='demo-static flex h-full justify-center'>
        <div ref={ref} className='flex w-full max-w-xl flex-col gap-5'>
          <div className='flex h-6 shrink-0 items-center gap-3'>
            <span className='min-w-0 truncate font-medium text-fg-4 text-sm'>{task.title}</span>
            <StatusText state={state} task={task} className='shrink-0 text-xs max-sm:hidden' />
            <span className='ms-auto'>
              <PullRequestBadge task={task} />
            </span>
          </div>
          <ol className='flex h-[420px] flex-col overflow-hidden'>
            {entries.map((entry) => (
              <ActivityRow key={entry.text} entry={entry} state={state} onOpenRun={() => undefined} />
            ))}
          </ol>
          <p className='h-10 shrink-0 border-bg-3 border-t pt-4 text-center text-fg-2 text-sm'>
            Asked of you so far: one review. The merge is next.
          </p>
        </div>
      </Stage>
    </DemoRoot>
  );
}
