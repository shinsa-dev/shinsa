import { type Gate, listOpenGates, type ShinsaState, type Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { cn } from '@shinsa/ui/lib/utils';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { EvidencePointer } from '@/components/evidence/evidence-pointer.tsx';
import { EvidenceSection } from '@/components/evidence/evidence-section.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { DelegationsPanel } from '@/components/overview/delegations-panel.tsx';
import { NowCard } from '@/components/overview/now-card.tsx';
import { ResultPanel } from '@/components/overview/result-panel.tsx';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { SuggestionsPanel } from '@/components/overview/suggestions-panel.tsx';
import { WatchdogsPanel } from '@/components/overview/watchdogs-panel.tsx';
import { MergeStepsBlock } from '@/components/review/merge-steps.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { useReadOnly } from '@/components/task/read-only.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { useProgressiveCount } from '@/hooks/use-progressive-count.ts';
import { listActivityNewestFirst, resolveOverviewSummary } from '@/lib/overview/activity.ts';
import { type NowTarget, resolveNowKind, resolveResultPlace } from '@/lib/overview/now.ts';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import { MERGE_STEP_TITLE } from '@/lib/review/merge-steps.ts';
import { describePointCount, listReviewChapters, listReviewPoints } from '@/lib/review/report.ts';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
import { isCodeTask } from '@/lib/tasks/shapes.ts';
import { hasReview } from '@/lib/tasks/tabs.ts';

const FIRST_ACTIVITY = 24;

function EvidencePlace({
  state,
  task,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  onOpen: (target: NowTarget) => void;
}) {
  if (hasReview(task)) return <EvidencePointer state={state} task={task} onOpen={() => onOpen('review')} />;
  return <EvidenceSection state={state} task={task} />;
}

function ChangesPanel({ task, onOpen }: { task: Task; onOpen: (target: NowTarget) => void }) {
  const report = task.report;
  if (!report || report.sections.length === 0) return null;
  const points = listReviewPoints(listReviewChapters(report, task.findings, task.reviewDisagreements));
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'changes')}
      title='What changed'
      icon='IconCodeLines'
      action={
        <Button variant='link' size='sm' onClick={() => onOpen('review')}>
          Read the review
        </Button>
      }
    >
      <ol className='flex flex-col gap-3'>
        {report.sections.map((section, index) => (
          <li key={section.title} className='flex gap-2.5'>
            <StepNumber index={index} />
            <div className='flex min-w-0 flex-1 flex-col gap-px'>
              <InlineMarkdown text={section.title} className='font-medium text-fg-4 text-xs leading-5' />
              <Markdown text={section.summary} className='text-fg-3 text-xs' />
            </div>
          </li>
        ))}
      </ol>
      <p className='text-2xs text-fg-2'>
        {describePointCount(points)} How it works, the code and every judgement call are in the review.
      </p>
    </Panel>
  );
}

function PostMergePanel({ state, task, gate }: { state: ShinsaState; task: Task; gate: Gate | undefined }) {
  const open = listOpenGates(state, task.id).some((candidate) => candidate.type === 'post_merge');
  const shown = gate?.type === 'post_merge' && resolveNowKind(state, task, gate) === 'gate';
  if (!open || shown) return null;
  return (
    <Panel
      persistId={resolveOverviewPanelId(task, 'post-merge')}
      title={MERGE_STEP_TITLE.post_merge}
      icon='IconChecklist'
    >
      <p className='text-fg-3 text-xs'>
        An earlier round merged and left these steps for you. The task is done once each is ticked.
      </p>
      <MergeStepsBlock task={task} when='post_merge' />
    </Panel>
  );
}

function ActivityPanel({
  state,
  task,
  onOpenRun,
}: {
  state: ShinsaState;
  task: Task;
  onOpenRun: (runId: string) => void;
}) {
  const entries = listActivityNewestFirst(task);
  const shown = useProgressiveCount(entries.length, FIRST_ACTIVITY);
  return (
    <Panel persistId={resolveOverviewPanelId(task, 'activity')} title='Activity' icon='IconClock'>
      <ol className='flex flex-col'>
        {entries.slice(0, shown).map((entry, index) => (
          <ActivityRow
            // biome-ignore lint/suspicious/noArrayIndexKey: entries can share a time and kind; the place counted from the oldest tells them apart
            key={`${entry.at}-${entry.kind}-${entries.length - index}`}
            entry={entry}
            state={state}
            onOpenRun={onOpenRun}
          />
        ))}
      </ol>
    </Panel>
  );
}

export function OverviewTab({
  state,
  task,
  gate,
  onOpen,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate | undefined;
  onOpen: (target: NowTarget, runId?: string) => void;
}) {
  const summary = resolveOverviewSummary(task);
  const code = isCodeTask(task);
  const readOnly = useReadOnly();
  const hint = readOnly ? null : resolveMessageHint(state, task);
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <PageScroll>
        <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
          <NowCard key={gate?.id ?? 'now'} state={state} task={task} gate={gate} onOpen={onOpen} />
          <SuggestionsPanel task={task} />
          <PostMergePanel state={state} task={task} gate={gate} />
          <WatchdogsPanel state={state} task={task} />
          {resolveResultPlace(state, task, gate) === 'panel' && <ResultPanel task={task} />}
          <DelegationsPanel state={state} task={task} onOpen={(runId) => onOpen('agent', runId)} />
          {code && (
            <Panel persistId={resolveOverviewPanelId(task, 'summary')} title='Summary' icon='IconNote1'>
              {summary ? (
                <Markdown text={summary} className='text-fg-4' />
              ) : (
                <p className='text-fg-2 text-xs'>
                  No summary yet. It appears once an agent hands over its work.
                </p>
              )}
            </Panel>
          )}
          <EvidencePlace state={state} task={task} onOpen={onOpen} />
          {code && <ChangesPanel task={task} onOpen={onOpen} />}
          <RoundsPanel state={state} task={task} onOpen={(runId) => onOpen('agent', runId)} />
          <ActivityPanel state={state} task={task} onOpenRun={(runId) => onOpen('agent', runId)} />
        </div>
      </PageScroll>
      {hint && (
        <Composer
          placeholder={hint.placeholder}
          submitLabel='Send message'
          onSubmit={(text) => sendTaskMessage(task, hint, text)}
          dock={<MessageQueue state={state} task={task} />}
        />
      )}
    </div>
  );
}
