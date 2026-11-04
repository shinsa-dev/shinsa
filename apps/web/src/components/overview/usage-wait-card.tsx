import type { ShinsaState, Task, UsageWait } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import {
  describeUsageWaitBody,
  describeUsageWaitCountdown,
  describeUsageWaitNote,
  describeUsageWaitTitle,
  describeUsageWaitToggle,
  isPaceWait,
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
  const project = task.projectId ? (state.projects[task.projectId] ?? null) : null;
  return (
    <NowFrame
      eyebrow={
        <Eyebrow
          state={state}
          task={task}
          extra={<TimeAgo at={wait.resetAt} text={(now) => describeUsageWaitCountdown(wait, now)} />}
        />
      }
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
          {!isPaceWait(wait) && (
            <QuietLink busy={busy !== null} onClick={() => void run('toggle', onToggle)}>
              {describeUsageWaitToggle(wait)}
            </QuietLink>
          )}
        </FooterNote>
      }
    >
      <p className='text-xs text-fg-3'>{describeUsageWaitBody(wait, project)}</p>
    </NowFrame>
  );
}
