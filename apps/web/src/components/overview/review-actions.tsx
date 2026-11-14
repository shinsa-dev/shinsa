import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@shinsa/ui/components/dropdown-menu';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import {
  canMergeAhead,
  describeApproveHint,
  type FollowUp,
  type FollowUpChoice,
  isFixingAction,
  listFollowUpChoices,
  isVerdictActionBlocked,
  resolveChosenFollowUp,
  resolveFollowUp,
  resolveFollowUpFlags,
  resolveVerdictAction,
  resolveVerdictAnswer,
  resolveVerdictDraft,
} from '@/lib/overview/verdicts.ts';
import { describeMergeBlock, resolveMergeLabel } from '@/lib/review/merge-steps.ts';
import { replyToGate, resolveApprovalReply } from '@/lib/tasks/gates.ts';

const SPLIT_PART = 'not-disabled:active:before:inset-0 not-disabled:data-[pressed]:before:inset-0';

function FollowUpMenu({
  choices,
  followUp,
  fixing,
  disabled,
  choose,
}: {
  choices: FollowUpChoice[];
  followUp: FollowUp;
  fixing: boolean;
  disabled: boolean;
  choose: (followUp: FollowUp) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            size='icon-sm'
            icon='IconChevronDownMedium'
            aria-label={fixing ? 'More ways to fix' : 'More ways to approve'}
            className={cn(SPLIT_PART, 'rounded-l-none data-popup-open:before:bg-primary/80')}
          />
        }
      />
      <DropdownMenuContent align='end' className='min-w-56'>
        <DropdownMenuRadioGroup
          value={followUp}
          onValueChange={(value) => choose(resolveChosenFollowUp(choices, value))}
        >
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value} closeOnClick>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ReviewActions({ state, task, gate }: { state: ShinsaState; task: Task; gate: Gate }) {
  const { busy, run } = useBusy<'merge' | 'decide'>();
  const draft = useReviewDraft();
  const supportsApproveAfterFix = useEngineFeature('review.approve_after_fix', task.id);
  const supportsApproveAndMerge = useEngineFeature('review.approve_and_merge', task.id);
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
  const choices = listFollowUpChoices(task.findings, verdicts, {
    approveAfterFix: supportsApproveAfterFix,
    approveAndMerge: supportsApproveAndMerge && canMergeAhead(state, task),
  });
  const chosen = resolveFollowUp(draft.thenApprove, draft.thenMerge);
  const followUp = choices.some((choice) => choice.value === chosen) ? chosen : 'none';
  const { thenApprove, thenMerge } = resolveFollowUpFlags(followUp);
  const action = resolveVerdictAction(task.findings, verdicts, thenApprove, thenMerge);
  const split = choices.length > 0;
  const button = (
    <Hint label={describeApproveHint(commented, action)}>
      <span className='flex w-fit'>
        <Button
          size='sm'
          loading={busy === 'decide'}
          disabled={isVerdictActionBlocked(commented, action)}
          className={split ? cn(SPLIT_PART, 'rounded-r-none') : undefined}
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
      <FollowUpMenu
        choices={choices}
        followUp={followUp}
        fixing={isFixingAction(action)}
        disabled={busy === 'decide'}
        choose={(next) => {
          const flags = resolveFollowUpFlags(next);
          draft.chooseThenApprove(flags.thenApprove);
          draft.chooseThenMerge(flags.thenMerge);
        }}
      />
    </div>
  );
}
