import type { TaskDiff } from '@shinsa/core';
import {
  type Gate,
  hasStep,
  listOpenGates,
  type ShinsaState,
  type Task,
  type WorkReport,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Spinner } from '@shinsa/ui/components/spinner';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { ReviewActions } from '@/components/overview/review-actions.tsx';
import { ReviewNote } from '@/components/review/note.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { ToneLabel } from '@/components/status/text.tsx';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useReviewKeys } from '@/hooks/use-review-keys.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listReviewCommands } from '@/lib/command/review.ts';
import { type Loaded, useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import {
  describeEscalationBody,
  resolveVerdict,
  resolveVerdictDraft,
  VERDICT_ITEMS,
} from '@/lib/overview/verdicts.ts';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';
import { REVIEW_KEY, type ReviewStep } from '@/lib/review/keys.ts';
import {
  describeAgentReview,
  describeAttentionCount,
  listAttentionItems,
  listOtherFiles,
  listReviewSections,
  type ReviewItem,
  stepReviewItem,
  toCommentItem,
  toFindingItem,
} from '@/lib/review/report.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';

function useReviewDiff(task: Task): Loaded<TaskDiff> {
  const refs = useTaskRefs(task);
  const ready = refs.status === 'ready' ? refs.value : null;
  const diff = useTaskDiff(task, ready?.base ?? null, ready?.base ? ready.head : null);
  if (refs.status === 'error') return refs;
  return diff;
}

function selectReviewGate(state: ShinsaState, task: Task): Gate | undefined {
  return listOpenGates(state, task.id).find((gate) => gate.type === 'review' || gate.type === 'merge');
}

function VerdictChoice({ task, gate, item }: { task: Task; gate: Gate | undefined; item: ReviewItem }) {
  const draft = useReviewDraft();
  if (item.finding === null || gate?.type !== 'review') return null;
  const verdicts = resolveVerdictDraft(task.findings, draft.verdicts);
  const index = item.finding;
  return (
    <Choice
      label='Verdict'
      items={VERDICT_ITEMS}
      value={resolveVerdict(verdicts, index)}
      onValueChange={(verdict) => draft.setVerdict(index, verdict)}
    />
  );
}

function StepButtons({ disabled, onStep }: { disabled: boolean; onStep: (step: ReviewStep) => void }) {
  return (
    <>
      <Hint label='Previous place' shortcut={REVIEW_KEY.previous}>
        <Button
          variant='secondary'
          size='icon-xs'
          icon='IconChevronTopMedium'
          aria-label='Previous place'
          disabled={disabled}
          onClick={() => onStep(-1)}
        />
      </Hint>
      <Hint label='Next place' shortcut={REVIEW_KEY.next}>
        <Button
          variant='secondary'
          size='icon-xs'
          icon='IconChevronDownMedium'
          aria-label='Next place'
          disabled={disabled}
          onClick={() => onStep(1)}
        />
      </Hint>
    </>
  );
}

function Attention({
  task,
  gate,
  items,
  selected,
  onStep,
}: {
  task: Task;
  gate: Gate | undefined;
  items: ReviewItem[];
  selected: string | null;
  onStep: (step: ReviewStep) => void;
}) {
  return (
    <section className='flex flex-col gap-2'>
      <SectionLabel
        count={items.length}
        action={<StepButtons disabled={items.length === 0} onStep={onStep} />}
      >
        Needs your attention
      </SectionLabel>
      {items.length === 0 ? (
        <p className='text-fg-2 text-xs'>{describeAttentionCount(items)}</p>
      ) : (
        items.map((item) => (
          <ReviewNote
            key={item.key}
            task={task}
            item={item}
            selected={item.key === selected}
            action={<VerdictChoice task={task} gate={gate} item={item} />}
          />
        ))
      )}
    </section>
  );
}

function Comments({ task, selected }: { task: Task; selected: string | null }) {
  const draft = useReviewDraft();
  if (draft.comments.length === 0) return null;
  return (
    <section className='flex flex-col gap-2'>
      <SectionLabel count={draft.comments.length}>Your comments</SectionLabel>
      {draft.comments.map((comment) => {
        const item = toCommentItem(comment);
        return (
          <ReviewNote
            key={item.key}
            task={task}
            item={item}
            selected={item.key === selected}
            action={
              <button
                type='button'
                className='cursor-pointer text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
                onClick={() => draft.removeComment(comment.id)}
              >
                Remove
              </button>
            }
          />
        );
      })}
    </section>
  );
}

function Walkthrough({ task, report }: { task: Task; report: WorkReport }) {
  const sections = listReviewSections(report);
  if (sections.length === 0) return null;
  return (
    <Panel title='Walkthrough' icon='IconCodeLines'>
      <ol className='flex flex-col gap-4'>
        {sections.map((section, index) => (
          <li key={section.title} className='flex gap-2.5'>
            <StepNumber index={index} />
            <div className='flex min-w-0 flex-1 flex-col gap-2'>
              <div className='flex flex-col gap-px'>
                <InlineMarkdown text={section.title} className='font-medium text-fg-4 text-xs leading-5' />
                <Markdown text={section.summary} className='text-fg-3 text-xs' />
              </div>
              {section.spots.map((spot) =>
                spot.place ? (
                  <ChangeSnippet
                    key={spot.key}
                    task={task}
                    path={spot.place.file}
                    start={spot.place.start}
                    end={spot.place.end}
                    why={spot.body}
                    spot={spot.key}
                    label={spot.tone === 'neutral' ? null : <ToneLabel label={spot.label} tone={spot.tone} />}
                  />
                ) : null
              )}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function AgentReview({ task }: { task: Task }) {
  const reviewed = task.findings.length > 0 || task.reviewSummary !== null;
  if (!reviewed && !hasStep(task, 'agent_review')) return null;
  return (
    <Panel title='Agent review' icon='IconEyeSparkle'>
      {reviewed ? (
        <div className='flex flex-col gap-1'>
          {task.reviewSummary && <Markdown text={task.reviewSummary} className='text-fg-4 text-xs' />}
          <p className='text-fg-3 text-xs'>{describeAgentReview(task.findings)}</p>
          <p className='text-2xs text-fg-2'>A signal for you, never the approval.</p>
        </div>
      ) : (
        <p className='text-fg-2 text-xs'>The agent review has not run yet.</p>
      )}
    </Panel>
  );
}

function Checks({ report }: { report: WorkReport }) {
  if (report.checks.length === 0) return null;
  return (
    <Panel title='Checks' icon='IconCheckCircle2'>
      <ul className='flex flex-col gap-1.5'>
        {report.checks.map((check) => (
          <li key={check.name} className='flex min-w-0 items-center gap-2 text-xs'>
            <CheckOutcomeIcon outcome={check.outcome} />
            <code className='shrink-0 font-mono text-2xs text-fg-4'>{check.name}</code>
            {check.detail && <Truncate className='text-2xs text-fg-2'>{check.detail}</Truncate>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EverythingElse({ task, report, diff }: { task: Task; report: WorkReport; diff: TaskDiff | null }) {
  const files = diff ? listOtherFiles(diff.files, report, task.findings) : [];
  const dismissed = task.dismissedFindings ?? [];
  if (files.length === 0 && dismissed.length === 0) return null;
  return (
    <Panel title='Everything else' icon='IconFiles' defaultOpen={false}>
      {files.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <span className='text-2xs text-fg-2'>Changed files the review does not point at</span>
          <ul className='flex flex-col gap-1'>
            {files.map((file) => (
              <li key={file.path} className='flex min-w-0 items-center gap-2 text-xs'>
                <FileLink task={task} path={file.path} />
                <span className='flex-1' />
                {file.binary ? (
                  <span className='text-2xs text-fg-2'>Binary</span>
                ) : (
                  <DiffStats added={file.additions} removed={file.deletions} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {dismissed.length > 0 && (
        <div className='flex flex-col gap-2'>
          <span className='text-2xs text-fg-2'>Findings you dismissed</span>
          {dismissed.map((finding, index) => (
            <ReviewNote
              key={`${finding.file}:${finding.line}:${finding.message}`}
              item={{ ...toFindingItem(finding, index), key: `dismissed:${index}`, finding: null }}
              compact
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReviewSummary({
  state,
  task,
  gate,
  report,
  items,
  diff,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate | undefined;
  report: WorkReport;
  items: ReviewItem[];
  diff: TaskDiff | null;
}) {
  const added = diff?.files.reduce((total, file) => total + file.additions, 0) ?? 0;
  const removed = diff?.files.reduce((total, file) => total + file.deletions, 0) ?? 0;
  return (
    <NowFrame
      eyebrow={
        <Eyebrow state={state} task={task} extra={diff && <DiffStats added={added} removed={removed} />} />
      }
      title={report.headline}
      action={gate && <ReviewActions task={task} gate={gate} />}
    >
      {gate?.escalation && <p className='text-fg-3 text-xs'>{describeEscalationBody(gate.escalation)}</p>}
      <p className='text-fg-3 text-xs'>{describeAttentionCount(items)}</p>
      {!task.report && (
        <p className='text-2xs text-fg-2'>
          The agent handed over no report, so Shinsa picked these places from the riskiest changes.
        </p>
      )}
    </NowFrame>
  );
}

export function ReviewTab({ state, task }: { state: ShinsaState; task: Task }) {
  const diff = useReviewDiff(task);
  const diffValue = diff.status === 'ready' ? diff.value : null;
  const report = React.useMemo(
    () => task.report ?? (diffValue ? resolveFallbackReport(diffValue, task.summary ?? task.title) : null),
    [task.report, task.summary, task.title, diffValue]
  );
  const items = React.useMemo(() => listAttentionItems(report, task.findings), [report, task.findings]);
  const selected = useSearchParam('spot');
  const gate = selectReviewGate(state, task);
  const step = (delta: ReviewStep) => {
    const next = stepReviewItem(items, selected, delta);
    if (next) updateSearchParams({ spot: next.key }, { replace: true });
  };
  useReviewKeys(step);
  useRegisterCommands([listReviewCommands({ taskId: task.id, count: items.length, step })]);
  if (!report) {
    return (
      <div className={cn(PAGE_COLUMN, 'flex items-center gap-2 py-5 text-fg-2 text-xs')}>
        {diff.status === 'error' ? (
          diff.message
        ) : (
          <>
            <Spinner size='sm' /> Reading the changes
          </>
        )}
      </div>
    );
  }
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <PageScroll>
        <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
          <ReviewSummary
            state={state}
            task={task}
            gate={gate}
            report={report}
            items={items}
            diff={diffValue}
          />
          <Attention task={task} gate={gate} items={items} selected={selected} onStep={step} />
          <Comments task={task} selected={selected} />
          <Walkthrough task={task} report={report} />
          <AgentReview task={task} />
          <Checks report={report} />
          <EverythingElse task={task} report={report} diff={diffValue} />
        </div>
      </PageScroll>
    </div>
  );
}
