import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { CHIP } from '@/components/layout/surface/card.ts';
import { PrLink } from '@/components/links/pull-request.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { AnswerBox } from '@/components/overview/answer-box.tsx';
import { Eyebrow, FooterNote, NowFrame, QuietLink } from '@/components/overview/now-frame.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useBusy } from '@/hooks/use-busy.ts';
import {
  type MergedCommit,
  OPERATION_SKIP,
  resolveMergedCommit,
  resolveNotesPlaceholder,
  resolveOperationBody,
} from '@/lib/overview/operation.ts';
import { type GateReplier, replyToGate } from '@/lib/tasks/gates.ts';

type OperationReply = 'runOperation' | 'runOperationWithNotes' | 'skipOperation';

function CommitChip({ commit }: { commit: MergedCommit }) {
  const { copied, copy } = useCopyText(commit.full);
  return (
    <Hint label={copied ? 'Copied' : 'Copy the full commit'} detail={copied ? null : commit.full}>
      <button
        type='button'
        aria-label={`Copy the commit ${commit.full}`}
        onClick={copy}
        className={cn(
          CHIP,
          'cursor-pointer font-mono text-2xs tabular-nums transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
        )}
      >
        {commit.short}
      </button>
    </Hint>
  );
}

function MergedLine({
  state,
  task,
  commit,
}: {
  state: ShinsaState;
  task: Task;
  commit: MergedCommit | null;
}) {
  return (
    <p className='flex flex-wrap items-center gap-1 text-fg-3 text-xs'>
      Merged
      {task.pullRequest && (
        <>
          {' '}
          in <PrLink state={state} task={task} />
        </>
      )}
      {commit && (
        <>
          {' '}
          as <CommitChip commit={commit} />
        </>
      )}
    </p>
  );
}

function SkipOperation({ busy, onSkip }: { busy: boolean; onSkip: () => void }) {
  const skipping = useDialogState<true>();
  return (
    <FooterNote note='Not needed any more? The change stays merged.'>
      <QuietLink busy={busy} onClick={() => skipping.show(true)}>
        {OPERATION_SKIP.action}
      </QuietLink>
      {skipping.value && (
        <ConfirmDialog
          control={skipping.control}
          title={OPERATION_SKIP.title}
          body={OPERATION_SKIP.body}
          action={OPERATION_SKIP.action}
          onConfirm={onSkip}
        />
      )}
    </FooterNote>
  );
}

export function OperationCard({
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
  const { busy, run } = useBusy<OperationReply>();
  const commit = resolveMergedCommit(task, gate);
  const merged = commit !== null || task.pullRequest !== null;
  const body = resolveOperationBody(gate, merged);
  const reply = (key: OperationReply, response: string | null = null) =>
    void run(key, () => onReply(key, response));

  return (
    <NowFrame
      eyebrow={<Eyebrow state={state} task={task} extra={<TimeAgo at={gate.openedAt} />} />}
      title={gate.title}
      action={
        <Button size='sm' loading={busy === 'runOperation'} onClick={() => reply('runOperation')}>
          Run the operation
        </Button>
      }
      footer={<SkipOperation busy={busy !== null} onSkip={() => reply('skipOperation')} />}
    >
      {merged && <MergedLine state={state} task={task} commit={commit} />}
      {body.caution && <Markdown text={body.caution} className='text-fg-3 text-xs' />}
      {body.rest && <Markdown text={body.rest} className='text-fg-3 text-xs' />}
      {gate.notes && (
        <div className='flex flex-col gap-px'>
          <p className='text-2xs text-fg-2'>Your notes for the operator</p>
          <Markdown text={gate.notes} className='text-fg-4 text-xs' />
        </div>
      )}
      <AnswerBox
        label='Notes for the operator'
        placeholder={resolveNotesPlaceholder(gate)}
        submitLabel='Run with these notes'
        variant='outline'
        busy={busy === 'runOperationWithNotes'}
        onSubmit={(text) => reply('runOperationWithNotes', text)}
      />
    </NowFrame>
  );
}
