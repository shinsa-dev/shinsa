import { isAgentQuestion, listOpenGates, type Run, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import { ScrollArea } from '@shinsa/ui/components/scroll-area';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { ContextMeter } from '@/components/chat/context-meter.tsx';
import { OpenDelegations } from '@/components/chat/delegation-card.tsx';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { RoundDivider } from '@/components/chat/round-divider.tsx';
import { ROW, RunSection } from '@/components/chat/run-section.tsx';
import { UserMessage } from '@/components/chat/user-message.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { CHAT_COLUMN } from '@/components/layout/surface/card.ts';
import { Composer } from '@/components/task/composer.tsx';
import { useOutbox } from '@/hooks/use-outbox.ts';
import { useStickToBottom } from '@/hooks/use-stick-to-bottom.ts';
import { useTranscriptWindow } from '@/hooks/use-transcript-window.ts';
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
import {
  findRunBlock,
  listTranscriptBlocks,
  resolveChatRunId,
  type TranscriptBlock,
} from '@/lib/chat/window.ts';
import {
  DisclosureScope,
  resolveTaskDisclosureId,
  useDisclosureScope,
} from '@/lib/preferences/disclosure.ts';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
import { hasRounds } from '@/lib/tasks/rounds.ts';

const NO_MESSAGES: never[] = [];

interface TranscriptProps {
  state: ShinsaState;
  task: Task;
  runs: Run[];
  focusRunId: string | null;
  scroller: React.RefObject<HTMLDivElement | null>;
  content: React.RefObject<HTMLDivElement | null>;
}

function TranscriptBlockView({
  block,
  task,
  byRun,
  waiting,
  rerunId,
}: {
  block: TranscriptBlock;
  task: Task;
  byRun: Map<string, HumanMessage[]>;
  waiting: boolean;
  rerunId: string | null;
}) {
  const messageId = useDisclosureScope('block', block.key, 'message');
  switch (block.kind) {
    case 'message':
      return (
        <div className={ROW}>
          <UserMessage
            persistId={messageId}
            text={block.message.text}
            status={block.message.status}
            reason={block.message.reason}
          />
        </div>
      );
    case 'round':
      return (
        <>
          <RoundDivider round={block.round} first={block.first} />
          <div className={ROW}>
            <UserMessage
              persistId={messageId}
              text={block.round.request}
              status={block.delivering ? 'delivering' : undefined}
            />
          </div>
        </>
      );
    case 'run':
      return (
        <RunSection
          run={block.run}
          task={task}
          messages={byRun.get(block.run.id) ?? NO_MESSAGES}
          first={block.first}
          waiting={waiting && block.run.endedAt === null}
          rerun={block.run.id === rerunId}
        />
      );
  }
}

function Transcript({ state, task, runs, focusRunId, scroller, content }: TranscriptProps) {
  const sending = useOutbox(task.id);
  const rounds = hasRounds(task);
  const messages = React.useMemo(
    () => (rounds ? listFollowUpMessages(task, sending) : listHumanMessages(task, sending)),
    [task, sending, rounds]
  );
  const { preamble, byRun } = React.useMemo(() => resolveRunMessages(runs, messages), [runs, messages]);
  const blocks = React.useMemo(
    () => listTranscriptBlocks(task, runs, preamble, rounds),
    [task, runs, preamble, rounds]
  );
  const focusIndex = findRunBlock(blocks, resolveChatRunId(state.runs, focusRunId));
  const start = useTranscriptWindow({ count: blocks.length, focusIndex, scroller, content });
  const waiting = listOpenGates(state, task.id).some(isAgentQuestion);
  const rerunId = selectRerunRun(task, runs)?.id ?? null;
  return (
    <>
      {runs.length === 0 && <EmptyState icon='IconRobot' {...describeEmptyChat(task)} className='min-h-80' />}
      {blocks.slice(start).map((block) => (
        <TranscriptBlockView
          key={block.key}
          block={block}
          task={task}
          byRun={byRun}
          waiting={waiting}
          rerunId={rerunId}
        />
      ))}
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
              <DisclosureScope value={resolveTaskDisclosureId(task.id, 'chat')}>
                <div ref={content} className={cn(PAGE_COLUMN, CHAT_COLUMN, 'flex flex-col pt-2 pb-6')}>
                  <Transcript
                    key={task.id}
                    state={state}
                    task={task}
                    runs={runs}
                    focusRunId={focusRunId}
                    scroller={scroller}
                    content={content}
                  />
                </div>
              </DisclosureScope>
            </OpenDelegations.Provider>
          </TaskEvidence.Provider>
        </ScrollArea>
        <div className='pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center'>
          {detached && (
            <Button
              variant='outline'
              size='sm'
              icon='IconArrowDown'
              className='pointer-events-auto'
              onClick={jumpToLatest}
            >
              Jump to latest
            </Button>
          )}
        </div>
      </div>
      {hint && (
        <Composer
          placeholder={hint.placeholder}
          submitLabel='Send message'
          onSubmit={(text) => sendTaskMessage(task, hint, text)}
          aside={<ContextMeter runIds={runs.map((run) => run.id)} />}
          dock={<MessageQueue task={task} />}
        />
      )}
    </div>
  );
}
