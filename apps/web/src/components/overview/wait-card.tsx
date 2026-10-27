import type { Monitor, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { TaskTrack } from '@/components/overview/progress-track.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { describeCheckInCount, describeGiveUp, describeNextCheckIn } from '@/lib/overview/wait.ts';
import { requestCheckInNow } from '@/lib/tasks/process.ts';

export function WaitCard({
  state,
  task,
  monitor,
  onCheck = () => requestCheckInNow(task.id),
}: {
  state: ShinsaState;
  task: Task;
  monitor: Monitor;
  onCheck?: () => Promise<boolean>;
}) {
  const { busy, run } = useBusy<'check'>();

  return (
    <NowFrame
      eyebrow={
        <Eyebrow
          state={state}
          task={task}
          extra={<TimeAgo at={monitor.nextCheckAt} text={(now) => describeNextCheckIn(monitor, now)} />}
        />
      }
      title='The agent is waiting on something outside the repository'
      action={
        <Button
          variant='outline'
          size='sm'
          loading={busy === 'check'}
          onClick={() => void run('check', onCheck)}
        >
          Check in now
        </Button>
      }
      footer={<TaskTrack task={task} />}
    >
      <div className='flex flex-col gap-px text-xs'>
        <InlineMarkdown text={monitor.notes} className='selectable text-fg-4' />
        <span className='text-2xs text-fg-2'>
          {describeCheckInCount(monitor)} ·{' '}
          <TimeAgo at={monitor.timeoutAt} text={(now) => describeGiveUp(monitor, now)} />
        </span>
      </div>
    </NowFrame>
  );
}
