import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { Hint } from '@/components/overlays/hint.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import {
  describeApproveHint,
  isFixingAction,
  isVerdictActionBlocked,
  resolveVerdictAction,
  resolveVerdictAnswer,
  resolveVerdictDraft,
  type VerdictDraft,
} from '@/lib/overview/verdicts.ts';
import { describeMergeBlock, resolveMergeLabel } from '@/lib/review/merge-steps.ts';
import { replyToGate, resolveApprovalReply } from '@/lib/tasks/gates.ts';

const FIX_CHOICE = { fix: 'fix', approve: 'approve' } as const;

function FixChoiceMenu({
  task,
  verdicts,
  thenApprove,
  disabled,
  choose,
}: {
  task: Task;
  verdicts: VerdictDraft;
  thenApprove: boolean;
  disabled: boolean;
  choose: (thenApprove: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            size='icon-sm'
            icon='IconChevronDownMedium'
            aria-label='More ways to fix'
            className='rounded-l-none'
          />
        }
      />
      <DropdownMenuContent align='end' className='min-w-56'>
        <DropdownMenuRadioGroup
          value={thenApprove ? FIX_CHOICE.approve : FIX_CHOICE.fix}
          onValueChange={(value) => choose(value === FIX_CHOICE.approve)}
        >
          <DropdownMenuRadioItem value={FIX_CHOICE.fix} closeOnClick>
            {resolveVerdictAction(task.findings, verdicts).label}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={FIX_CHOICE.approve} closeOnClick>
            {resolveVerdictAction(task.findings, verdicts, true).label}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ReviewActions({ state, task, gate }: { state: ShinsaState; task: Task; gate: Gate }) {
  const { busy, run } = useBusy<'merge' | 'decide'>();
  const draft = useReviewDraft();
  const supportsApproveAfterFix = useEngineFeature('review.approve_after_fix', task.id);
  if (gate.type === 'merge') {
    const blocked = describeMergeBlock(task);
    const button = (
      <Button
        size='sm'
        icon='IconMerged'
        loading={busy === 'merge'}
        disabled={blocked !== null}
        onClick={() => void run('merge', () => replyToGate(gate, resolveApprovalReply(task, gate, 'merge')))}
      >
        {resolveMergeLabel(state, task, 'Merge')}
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
  const thenApprove = supportsApproveAfterFix && draft.thenApprove;
  const action = resolveVerdictAction(task.findings, verdicts, thenApprove);
  const split = supportsApproveAfterFix && isFixingAction(action);
  const button = (
    <Hint label={describeApproveHint(commented, action)}>
      <span className='flex w-fit'>
        <Button
          size='sm'
          loading={busy === 'decide'}
          disabled={isVerdictActionBlocked(commented, action)}
          className={split ? 'rounded-r-none' : undefined}
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
  if (!split) return button;
  return (
    <div className='flex w-fit items-stretch'>
      {button}
      <span aria-hidden className='w-px bg-primary-foreground/25' />
      <FixChoiceMenu
        task={task}
        verdicts={verdicts}
        thenApprove={thenApprove}
        disabled={busy === 'decide'}
        choose={draft.chooseThenApprove}
      />
    </div>
  );
}
