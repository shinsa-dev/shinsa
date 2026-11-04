import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { QuestionChoices } from '@/components/overview/question-choices.tsx';
import { useReadOnly } from '@/components/task/read-only.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { type GateReplier, type GateReply, replyToGate } from '@/lib/tasks/gates.ts';

export function SetupCard({
  state,
  task,
  gate,
  onReply = (key, response) => replyToGate(gate, key, response),
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate;
  onReply?: GateReplier;
}) {
  const readOnly = useReadOnly();
  const { busy, run } = useBusy<GateReply>();
  const reply = (key: GateReply, response?: string) => void run(key, () => onReply(key, response));
  const asksRepository = (gate.choices ?? []).length > 0;
  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        !asksRepository && (
          <Button size='sm' loading={busy === 'recheck'} onClick={() => reply('recheck')}>
            Verify again
          </Button>
        )
      }
      footer={
        <FooterNote
          note={
            asksRepository
              ? 'Picking one verifies the setup again.'
              : 'Fix it in the repository or in Settings, then verify it again.'
          }
        >
          <QuietLink busy={busy !== null} onClick={() => reply('cancel')}>
            Cancel task
          </QuietLink>
        </FooterNote>
      }
    >
      {gate.body && <Markdown text={gate.body} className='text-xs text-fg-3' />}
      {!readOnly && (
        <QuestionChoices
          gate={gate}
          busy={busy !== null}
          onPick={(choice) => reply('pickRepository', choice)}
        />
      )}
    </NowFrame>
  );
}
