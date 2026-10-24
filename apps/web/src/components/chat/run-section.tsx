import type { Run, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RunAccount } from '@/components/accounts/account-items.tsx';
import { DelegationNotice } from '@/components/chat/delegation-card.tsx';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import { LiveCard } from '@/components/chat/live-card.tsx';
import { NoticeLine } from '@/components/chat/notice-line.tsx';
import { RowChevron } from '@/components/chat/tool-group.tsx';
import { AgentText, ErrorLine, TurnDetail } from '@/components/chat/turn-detail.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { Duration } from '@/components/text/time-ago.tsx';
import { RunEvidence, TaskEvidence } from '@/lib/chat/run-evidence.ts';
import { resolveRunHeadline } from '@/lib/chat/run-role.ts';
import { type HumanMessage, type RunTurn, resolveTimeline, resolveTurns } from '@/lib/chat/timeline.ts';
import { resolveClosing } from '@/lib/chat/turns.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { formatSteps } from '@/lib/format/count.ts';

export const ROW = 'px-3 py-2 mb-1';

const NO_MESSAGES: HumanMessage[] = [];

const NO_EVIDENCE: never[] = [];

function RunEvidenceScope({ runId, children }: { runId: string; children: React.ReactNode }) {
  const evidence = React.useContext(TaskEvidence).get(runId) ?? NO_EVIDENCE;
  return <RunEvidence.Provider value={evidence}>{children}</RunEvidence.Provider>;
}

function WorkedRow({ run, turn }: { run: Run; turn: RunTurn }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className='flex min-w-0 flex-col'>
      <button
        type='button'
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className='group/row flex h-5 cursor-pointer items-center gap-px self-start text-fg-2 text-xs transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
      >
        <span className='tabular-nums'>
          Worked for <Duration from={turn.startedAt} to={turn.endedAt} />
          {turn.steps > 0 && ` · ${formatSteps(turn.steps)}`}
        </span>
        <RowChevron open={open} className='text-current' />
      </button>
      {open && (
        <div className='mt-3 mb-1 border-border border-l ps-4'>
          <TurnDetail items={turn.work} run={run} />
        </div>
      )}
    </div>
  );
}

function TurnView({
  run,
  task,
  turn,
  waiting,
}: {
  run: Run;
  task: Task | null;
  turn: RunTurn;
  waiting: boolean;
}) {
  return (
    <>
      {turn.human && (
        <div className={ROW}>
          <UserMessage text={turn.human.text} attachments={turn.human.attachments} />
        </div>
      )}
      {turn.notices.map((item) => (
        <div key={item.key} className={ROW}>
          {item.kind === 'delegation' ? (
            task && (
              <DelegationNotice
                item={item}
                conversation={(view) => <RunTurns run={view.run} task={task} />}
              />
            )
          ) : (
            <NoticeLine item={item} />
          )}
        </div>
      ))}
      {turn.live && (
        <div className={ROW}>
          <LiveCard run={run} turn={turn} waiting={waiting} />
        </div>
      )}
      {!turn.live && turn.work.length > 0 && (
        <div className={ROW}>
          <WorkedRow run={run} turn={turn} />
        </div>
      )}
      {turn.outcomes.map((item) => (
        <div key={item.key} className={ROW}>
          <HandoverCard call={item.call} run={run} live={turn.live} />
        </div>
      ))}
      {turn.reply && (
        <div className={ROW}>
          <AgentText text={turn.reply.text} />
        </div>
      )}
      {turn.errors.map((item) => (
        <div key={item.key} className={ROW}>
          <ErrorLine text={item.text} />
        </div>
      ))}
    </>
  );
}

function RunLabel({
  run,
  task,
  headline,
  first,
  rerun,
}: {
  run: Run;
  task: Task;
  headline: string;
  first: boolean;
  rerun: boolean;
}) {
  return (
    <div
      className={cn('flex min-w-0 items-center gap-3 px-3 pb-2 text-2xs text-fg-2', first ? 'pt-2' : 'pt-4')}
    >
      <span className='flex min-w-0 items-center gap-1'>
        <Truncate>
          {headline}
          {run.outcome === 'failed' && <span className='text-red-text'> · Failed</span>}
          {run.outcome === 'cancelled' && <span> · Stopped</span>}
        </Truncate>
        <RunAccount task={task} run={run} rerun={rerun} />
      </span>
      <span aria-hidden className='h-px min-w-6 flex-1 bg-border' />
    </div>
  );
}

function RunTurns({ run, task }: { run: Run; task: Task }) {
  const entries = useTranscript(run.id);
  const turns = React.useMemo(() => resolveTurns(resolveTimeline(entries, NO_MESSAGES), run), [entries, run]);
  const closing = resolveClosing(run, turns);
  return (
    <RunEvidenceScope runId={run.id}>
      {turns.map((turn) => (
        <TurnView key={turn.key} run={run} task={task} turn={turn} waiting={false} />
      ))}
      {closing && (
        <div className={ROW}>
          {closing.kind === 'error' ? <ErrorLine text={closing.text} /> : <AgentText text={closing.text} />}
        </div>
      )}
    </RunEvidenceScope>
  );
}

export function RunSection({
  run,
  task,
  messages,
  first,
  waiting,
  rerun = false,
}: {
  run: Run;
  task: Task;
  messages: HumanMessage[];
  first: boolean;
  waiting: boolean;
  rerun?: boolean;
}) {
  const entries = useTranscript(run.id);
  const turns = React.useMemo(
    () => resolveTurns(resolveTimeline(entries, messages), run),
    [entries, messages, run]
  );
  const headline = React.useMemo(() => resolveRunHeadline(run, task, entries), [run, task, entries]);
  const closing = resolveClosing(run, turns);
  return (
    <RunEvidenceScope runId={run.id}>
      <section
        id={`run-${run.id}`}
        className='corner-superellipse/1.125 flex scroll-mt-4 flex-col rounded-xl transition-colors duration-500 data-focused:bg-primary-a1'
      >
        <RunLabel run={run} task={task} headline={headline} first={first} rerun={rerun} />
        {turns.map((turn) => (
          <TurnView key={turn.key} run={run} task={task} turn={turn} waiting={waiting} />
        ))}
        {closing && (
          <div className={ROW}>
            {closing.kind === 'error' ? <ErrorLine text={closing.text} /> : <AgentText text={closing.text} />}
          </div>
        )}
      </section>
    </RunEvidenceScope>
  );
}
