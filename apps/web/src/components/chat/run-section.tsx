import type { Run, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { RunAccount } from '@/components/accounts/account-items.tsx';
import { ChatLine, DetailRail, FoldLine, SELECTED_WASH } from '@/components/chat/chat-line.tsx';
import { DelegationNotice } from '@/components/chat/delegation-card.tsx';
import { HandoverCard } from '@/components/chat/handover-card.tsx';
import { LiveCard } from '@/components/chat/live-card.tsx';
import { NoticeLine } from '@/components/chat/notice-line.tsx';
import { AgentText, ErrorLine, TurnDetail } from '@/components/chat/turn-detail.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { CHAT_INSET, CHAT_PROSE_INSET } from '@/components/layout/surface/card.ts';
import { Duration } from '@/components/text/time-ago.tsx';
import { RunEvidence, TaskEvidence } from '@/lib/chat/run-evidence.ts';
import { RUN_ROLE, resolveRunHeadline } from '@/lib/chat/run-role.ts';
import { type HumanMessage, type RunTurn, resolveTimeline, resolveTurns } from '@/lib/chat/timeline.ts';
import { resolveClosing } from '@/lib/chat/turns.ts';
import { useTranscript } from '@/lib/connection/socket.ts';
import { formatSteps } from '@/lib/format/count.ts';

export const ROW = 'py-2 mb-1';

const LINE_ROW = cn(ROW, CHAT_INSET);

const PROSE_ROW = cn(ROW, CHAT_PROSE_INSET);

const SECTION_EDGES =
  'mb-3 [&>:first-child]:mt-0 [&>:first-child]:pt-0 [&>:last-child]:mb-0 [&>:last-child]:pb-0';

function resolveSectionTop(first: boolean, opening: boolean) {
  if (first) return 'mt-2';
  return opening ? 'mt-6' : 'mt-5';
}

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
      <FoldLine
        open={open}
        onToggle={() => setOpen(!open)}
        label={
          <span className='tabular-nums'>
            Worked for <Duration from={turn.startedAt} to={turn.endedAt} />
          </span>
        }
        meta={turn.steps > 0 && <span className='tabular-nums'>{formatSteps(turn.steps)}</span>}
      />
      {open && (
        <DetailRail className='pb-0'>
          <TurnDetail items={turn.work} run={run} />
        </DetailRail>
      )}
    </div>
  );
}

function TurnView({
  run,
  task,
  turn,
  waiting,
  lead = true,
}: {
  run: Run;
  task: Task | null;
  turn: RunTurn;
  waiting: boolean;
  lead?: boolean;
}) {
  return (
    <>
      {lead && turn.human && (
        <div className={ROW}>
          <UserMessage
            text={turn.human.text}
            attachments={turn.human.attachments}
            pending={turn.human.pending === true}
          />
        </div>
      )}
      {turn.notices.map((item) => (
        <div key={item.key} className={item.kind === 'delegation' ? ROW : LINE_ROW}>
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
        <div className={LINE_ROW}>
          <WorkedRow run={run} turn={turn} />
        </div>
      )}
      {turn.outcomes.map((item) => (
        <div key={item.key} className={ROW}>
          <HandoverCard call={item.call} run={run} live={turn.live} task={task} />
        </div>
      ))}
      {turn.reply && (
        <div className={PROSE_ROW}>
          <AgentText text={turn.reply.text} />
        </div>
      )}
      {turn.errors.map((item) => (
        <div key={item.key} className={LINE_ROW}>
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
  const role = RUN_ROLE[run.role];
  return (
    <ChatLine
      className={cn('mb-2 w-full', CHAT_INSET, first ? 'mt-2' : 'mt-5')}
      icon={role.icon}
      label={role.name}
      meta={
        <span className='flex min-w-0'>
          <Truncate className='min-w-0'>{headline}</Truncate>
          <span className='shrink-0'>
            {run.outcome === 'failed' && <span className='text-red-text'> · Failed</span>}
            {run.outcome === 'cancelled' && ' · Stopped'} <RunAccount task={task} run={run} rerun={rerun} />
          </span>
        </span>
      }
    />
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
        <div className={closing.kind === 'error' ? LINE_ROW : PROSE_ROW}>
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
  const opening = turns[0]?.human ?? null;
  return (
    <RunEvidenceScope runId={run.id}>
      <section
        id={`run-${run.id}`}
        className={cn(
          'corner-superellipse/1.125 flex scroll-mt-4 flex-col rounded-xl',
          SECTION_EDGES,
          resolveSectionTop(first, opening !== null),
          SELECTED_WASH
        )}
      >
        {opening && (
          <div className={ROW}>
            <UserMessage
              text={opening.text}
              attachments={opening.attachments}
              pending={opening.pending === true}
            />
          </div>
        )}
        <RunLabel run={run} task={task} headline={headline} first={first || opening !== null} rerun={rerun} />
        {turns.map((turn, index) => (
          <TurnView key={turn.key} run={run} task={task} turn={turn} waiting={waiting} lead={index > 0} />
        ))}
        {closing && (
          <div className={closing.kind === 'error' ? LINE_ROW : PROSE_ROW}>
            {closing.kind === 'error' ? <ErrorLine text={closing.text} /> : <AgentText text={closing.text} />}
          </div>
        )}
      </section>
    </RunEvidenceScope>
  );
}
