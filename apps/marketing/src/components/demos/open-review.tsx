import type { ShinsaState, Task } from '@shinsa/core';
import * as React from 'react';
import { ReviewTab } from '@/routes/task/review.tsx';
import { openTask } from '../../lib/content.ts';
import { readReviewFragment } from '../../lib/open.ts';
import { createOpenState } from '../../lib/open-scene.ts';
import { DemoRoot, Window } from './frame.tsx';

const WINDOW_STYLE = {
  '--wide-w': '1040px',
  '--wide-h': 'clamp(420px, 100svh - 240px, 820px)',
  '--narrow-h': '684px',
  '--window-extra': '0px',
} as React.CSSProperties;

export function OpenReview() {
  const [scene, setScene] = React.useState<{ state: ShinsaState; task: Task } | null>(null);
  React.useEffect(() => {
    void readReviewFragment(window.location.hash).then((payload) => {
      if (payload) setScene(createOpenState(payload, Date.now()));
    });
  }, []);
  if (!scene) return null;
  return (
    <div className='@container mx-auto mt-12 w-full max-w-5xl md:mt-14' data-chip>
      <p className='mb-3 text-center text-fg-2 text-sm'>{openTask.source}</p>
      <div className='demo-window' style={WINDOW_STYLE}>
        <DemoRoot>
          <div className='demo-scroll h-full'>
            <Window
              state={scene.state}
              route={{ name: 'task', reference: scene.task.handle ?? scene.task.id }}
            >
              <div className='flex h-full min-h-0 flex-col'>
                <ReviewTab state={scene.state} task={scene.task} />
              </div>
            </Window>
          </div>
        </DemoRoot>
      </div>
    </div>
  );
}
