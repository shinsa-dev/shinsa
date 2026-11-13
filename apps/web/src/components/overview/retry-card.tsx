import type { AutoRetry, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { InlineMarkdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { describeRetryCount, describeRetryCountdown, RETRY_NOTE } from '@/lib/overview/retry.ts';
import { requestRetryNow, stopRetrying } from '@/lib/tasks/process.ts';

export function RetryCard({
  state,
  task,
  retry,
  onRetry = () => requestRetryNow(task.id),
  onStop = () => stopRetrying(task.id),
}: {
  state: ShinsaState;
  task: Task;
  retry: AutoRetry;
  onRetry?: () => Promise<boolean>;
  onStop?: () => Promise<boolean>;
}) {
  const { busy, run } = useBusy<'retry' | 'stop'>();
  return (
    <NowFrame
      eyebrow={
        <Eyebrow
          state={state}
          task={task}
          extra={<TimeAgo at={retry.at} text={(now) => describeRetryCountdown(retry, now)} />}
        />
      }
      title={retry.title}
      action={
        <Button
          variant='outline'
          size='sm'
          loading={busy === 'retry'}
          onClick={() => void run('retry', onRetry)}
        >
          Retry now
        </Button>
      }
      footer={
        <FooterNote note={`${describeRetryCount(retry)}. ${RETRY_NOTE}`}>
          <QuietLink busy={busy !== null} onClick={() => void run('stop', onStop)}>
            Stop retrying
          </QuietLink>
        </FooterNote>
      }
    >
      <InlineMarkdown text={retry.detail} className='selectable text-xs text-fg-4' />
    </NowFrame>
  );
}
