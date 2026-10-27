import type { Gate, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Hint } from '@/components/overlays/hint.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import {
  describeApproveHint,
  isVerdictActionBlocked,
  resolveVerdictAction,
  resolveVerdictAnswer,
  resolveVerdictDraft,
} from '@/lib/overview/verdicts.ts';
import { replyToGate, resolveApprovalReply } from '@/lib/tasks/gates.ts';

export function ReviewActions({ task, gate }: { task: Task; gate: Gate }) {
  const { busy, run } = useBusy<'merge' | 'decide'>();
  const draft = useReviewDraft();
  if (gate.type === 'merge') {
    return (
      <Button
        size='sm'
        icon='IconMerged'
        loading={busy === 'merge'}
        disabled={blocked !== null}
        onClick={() => void run('merge', () => replyToGate(gate, resolveApprovalReply(task, gate, 'merge')))}
      >
        {task.pullRequest ? `Merge #${task.pullRequest.number}` : 'Merge'}
      </Button>
    );
    if (!blocked) return button;
    return (
      <Hint label={blocked}>
        <span className='flex w-fit'>{button}</span>
      </Hint>
    );
  }
  const commented = draft.comments.length > 0;
  const verdicts = resolveVerdictDraft(task.findings, draft.verdicts);
  const action = resolveVerdictAction(task.findings, verdicts);
  return (
    <Hint label={describeApproveHint(commented, action)}>
      <span className='flex w-fit'>
        <Button
          size='sm'
          loading={busy === 'decide'}
          disabled={isVerdictActionBlocked(commented, action)}
          onClick={() =>
            void run('decide', async () => {
              const extras = resolveVerdictAnswer(task.findings, verdicts, draft.comments);
              const sent = await replyToGate(
                gate,
                resolveApprovalReply(task, gate, action.reply),
                null,
                extras
              );
              if (sent && extras.comments) draft.clearComments();
              return sent;
            })
          }
        >
          {action.label}
        </Button>
      </span>
    </Hint>
  );
}
