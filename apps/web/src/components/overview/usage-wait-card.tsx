import type { ShinsaState, Task, UsageWait } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { ResetTime } from '@/components/accounts/usage-bar.tsx';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  describeUsageWaitBody,
  describeUsageWaitNote,
  describeUsageWaitTitle,
  describeUsageWaitToggle,
} from '@/lib/accounts/usage-wait.ts';
import { resumeUsageWaitNow, updateUsageWait } from '@/lib/connection/accounts.ts';

export function UsageWaitCard({
  state,
  task,
  wait,
  onResume = () => resumeUsageWaitNow(task.id),
  onToggle = () => updateUsageWait(task.id, !wait.autoResume),
}: {
  state: ShinsaState;
  task: Task;
  wait: UsageWait;
  onResume?: () => Promise<boolean>;
  onToggle?: () => Promise<boolean>;
}) {
  const { busy, run } = useBusy<'resume' | 'toggle'>();
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<ResetTime at={wait.resetAt} />} />}
      title={describeUsageWaitTitle(wait)}
      action={
        <Button
          variant='outline'
          size='sm'
          loading={busy === 'resume'}
          onClick={() => void run('resume', onResume)}
        >
          {ACCOUNT_LABEL.resumeNow}
        </Button>
      }
      footer={
        <FooterNote note={describeUsageWaitNote(wait)}>
          <QuietLink busy={busy !== null} onClick={() => void run('toggle', onToggle)}>
            {describeUsageWaitToggle(wait)}
          </QuietLink>
        </FooterNote>
      }
    >
      <p className='text-fg-3 text-xs'>{describeUsageWaitBody(wait)}</p>
    </NowFrame>
  );
}
