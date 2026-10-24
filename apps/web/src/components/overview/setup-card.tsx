import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { canSkipChecks } from '@/lib/overview/setup.ts';
import { type GateReplier, type GateReply, replyToGate } from '@/lib/tasks/gates.ts';

export function SetupCard({
  state,
  task,
  gate,
  onReply = (key) => replyToGate(gate, key),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply?: GateReplier;
}) {
  const { busy, run } = useBusy<GateReply>();
  const reply = (key: GateReply) => void run(key, () => onReply(key));
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        <>
          {canSkipChecks(task) && (
            <Button
              variant='outline'
              size='sm'
              loading={busy === 'skipChecks'}
              onClick={() => reply('skipChecks')}
            >
              Start without checks
            </Button>
          )}
          <Button size='sm' loading={busy === 'recheck'} onClick={() => reply('recheck')}>
            Check again
          </Button>
        </>
      }
      footer={
        <FooterNote note='Fix it in the repository or in Settings, then check again.'>
          <QuietLink busy={busy !== null} onClick={() => reply('cancel')}>
            Cancel task
          </QuietLink>
        </FooterNote>
      }
    >
      {gate.body && <Markdown text={gate.body} className='text-fg-3 text-xs' />}
    </NowFrame>
  );
}
