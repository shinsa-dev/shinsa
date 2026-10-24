import { isAgentQuestion, listOpenGates, type Run, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ContextMeter } from '@/components/chat/context-meter.tsx';
import { OpenDelegations } from '@/components/chat/delegation-card.tsx';
import { RoundDivider } from '@/components/chat/round-divider.tsx';
import { ROW, RunSection } from '@/components/chat/run-section.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CHAT_COLUMN } from '@/components/layout/surface/card.ts';
import { Composer } from '@/components/task/composer.tsx';
import { useOutbox } from '@/hooks/use-outbox.ts';
import { useStickToBottom } from '@/hooks/use-stick-to-bottom.ts';
import { selectRerunRun } from '@/lib/accounts/account.ts';
import { listChatRuns, listDelegationPath } from '@/lib/chat/delegations.ts';
import { TaskEvidence } from '@/lib/chat/run-evidence.ts';
import { describeEmptyChat, groupEvidenceByRun, listTaskRuns } from '@/lib/chat/runs.ts';
import {
  type HumanMessage,
  listFollowUpMessages,
  listHumanMessages,
  resolveRunMessages,
} from '@/lib/chat/timeline.ts';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
import { hasRounds, listRoundSections } from '@/lib/tasks/rounds.ts';

const NO_MESSAGES: never[] = [];

interface RunListProps {
  task: Task;
  byRun: Map<string, HumanMessage[]>;
  waiting: boolean;
  rerunId: string | null;
}

function RunList({ runs, leading, ...props }: RunListProps & { runs: Run[]; leading: boolean }) {
  return runs.map((run, index) => (
    <RunSection
      key={run.id}
      run={run}
      task={props.task}
      messages={props.byRun.get(run.id) ?? NO_MESSAGES}
      first={index === 0 && leading}
      waiting={props.waiting && run.endedAt === null}
      rerun={run.id === props.rerunId}
    />
  ));
}

function Transcript({ state, task, runs }: { state: ShinsaState; task: Task; runs: Run[] }) {
  const sending = useOutbox(task.id);
  const rounds = hasRounds(task);
  const messages = React.useMemo(
    () => (rounds ? listFollowUpMessages(task, sending) : listHumanMessages(task, sending)),
    [task, sending, rounds]
  );
  const { preamble, byRun } = React.useMemo(() => resolveRunMessages(runs, messages), [runs, messages]);
  const list: RunListProps = {
    task,
    byRun,
    waiting: listOpenGates(state, task.id).some(isAgentQuestion),
    rerunId: selectRerunRun(task, runs)?.id ?? null,
  };
  return (
    <>
      {runs.length === 0 && <EmptyState icon='IconRobot' {...describeEmptyChat(task)} className='min-h-80' />}
      {preamble.map((message) => (
        <div key={`${message.at}-${message.text.length}`} className={ROW}>
          <UserMessage text={message.text} pending={message.pending === true} />
        </div>
      ))}
      {rounds ? (
        listRoundSections(task, runs).map((section, index) => (
          <React.Fragment key={section.round.number}>
            <RoundDivider round={section.round} first={index === 0 && preamble.length === 0} />
            <div className={ROW}>
              <UserMessage text={section.round.request} />
            </div>
            <RunList {...list} runs={section.runs} leading />
          </React.Fragment>
        ))
      ) : (
        <RunList {...list} runs={runs} leading={preamble.length === 0} />
      )}
    </>
  );
}

export function ChatTab({
  state,
  task,
  focusRunId = null,
}: {
  state: ShinsaState;
  task: Task;
  focusRunId?: string | null;
}) {
  const runs = React.useMemo(() => listChatRuns(listTaskRuns(state.runs, task.id)), [state.runs, task.id]);
  const evidence = React.useMemo(
    () => groupEvidenceByRun(state.evidence, task.id),
    [state.evidence, task.id]
  );
  const opened = React.useMemo(() => listDelegationPath(state, focusRunId), [state, focusRunId]);
  const { scroller, content, detached, onScroll, jumpToLatest } = useStickToBottom(focusRunId);
  const hint = resolveMessageHint(state, task);

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='relative flex min-h-0 flex-1 flex-col'>
        <ScrollArea
          viewportRef={scroller}
          onScroll={onScroll}
          className='min-h-0 flex-1'
          viewportClassName='overscroll-y-contain'
        >
          <TaskEvidence.Provider value={evidence}>
            <OpenDelegations.Provider value={opened}>
              <div ref={content} className={cn(PAGE_COLUMN, CHAT_COLUMN, 'flex flex-col pt-2 pb-6')}>
                <Transcript state={state} task={task} runs={runs} />
              </div>
            </OpenDelegations.Provider>
          </TaskEvidence.Provider>
        </ScrollArea>
        {detached && (
          <div className='pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center'>
            <Button
              variant='outline'
              size='sm'
              icon='IconArrowDown'
              className='pointer-events-auto'
              onClick={jumpToLatest}
            >
              Jump to latest
            </Button>
          </div>
        )}
      </div>
      {hint && (
        <Composer
          placeholder={hint.placeholder}
          submitLabel='Send message'
          onSubmit={(text) => sendTaskMessage(task, hint, text)}
          aside={<ContextMeter runIds={runs.map((run) => run.id)} />}
        />
      )}
    </div>
  );
}
