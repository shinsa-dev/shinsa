import { type Monitor, resolveTaskProgress, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { ProgressTrack } from '@/components/overview/progress-track.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { describeCheckCount, describeGiveUp, describeNextCheck } from '@/lib/overview/wait.ts';
import { requestCheckNow } from '@/lib/tasks/process.ts';

export function WaitCard({
  state,
  task,
  monitor,
  onCheck = () => requestCheckNow(task.id),
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
          extra={<TimeAgo at={monitor.nextCheckAt} text={(now) => describeNextCheck(monitor, now)} />}
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
          Check now
        </Button>
      }
      footer={<ProgressTrack progress={resolveTaskProgress(task)} />}
    >
      <div className='flex flex-col gap-px text-xs'>
        <InlineMarkdown text={monitor.notes} className='text-fg-4' />
        <span className='text-2xs text-fg-2'>
          {describeCheckCount(monitor)} ·{' '}
          <TimeAgo at={monitor.timeoutAt} text={(now) => describeGiveUp(monitor, now)} />
        </span>
      </div>
    </NowFrame>
  );
}
