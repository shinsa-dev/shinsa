import type { ShinsaState, Task } from '@shinsa/core';
import type * as React from 'react';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { TaskTrack } from '@/components/overview/progress-track.tsx';
import { MergeStepsBlock } from '@/components/review/merge-steps.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { describePostMergeTitle } from '@/lib/review/merge-steps.ts';

export function PostMergeCard({
  state,
  task,
  onTick,
}: {
  state: ShinsaState;
  task: Task;
  onTick?: React.ComponentProps<typeof MergeStepsBlock>['onTick'];
}) {
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={task.stageChangedAt} />} />}
      title={describePostMergeTitle(task)}
      footer={<TaskTrack task={task} />}
    >
      <p className='text-fg-3 text-xs'>
        The change is in. These steps need you or production access, so no agent runs them. Tick each one once
        it is done.
      </p>
      <MergeStepsBlock task={task} when='post_merge' onTick={onTick} />
    </NowFrame>
  );
}
