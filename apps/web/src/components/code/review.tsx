import type { Task, TaskDiff, WorkReport } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { CodeView } from '@/components/code/code-view.tsx';
import { Choice } from '@/components/controls/choice.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { Toolbar } from '@/components/layout/page/toolbar.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { AttentionLabel } from '@/components/status/text.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { openWorktree } from '@/lib/connection/worktree.ts';
import { TONE_FILL } from '@/lib/format/tone.ts';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';
import { describeFindingPlace } from '@/lib/review/findings.ts';
import {
  createDecisionTarget,
  formatTargetLines,
  listFindingMarkers,
  listFindingTargets,
  listReviewTargets,
  REVIEW_ORDERS,
  type ReviewOrder,
  type ReviewTarget,
  stepTarget,
  toReviewTarget,
} from '@/lib/review/targets.ts';
import { ATTENTION } from '@/lib/tasks/status.ts';

function SpotButton({
  target,
  selected,
  showSection,
  onSelect,
}: {
  target: ReviewTarget;
  selected: boolean;
  showSection: boolean;
  onSelect: () => void;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  return (
    <button
      ref={ref}
      type='button'
      onClick={onSelect}
      aria-current={selected || undefined}
      className={cn(
        'corner-superellipse/1.125 relative flex w-full cursor-pointer flex-col gap-px rounded-control py-1.5 pr-2 pl-4 text-left outline-none transition-colors duration-150',
        selected ? 'bg-bg-a3' : 'hover:bg-bg-a2 active:bg-bg-a2'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-2 left-1.5 w-0.5 rounded-full',
          TONE_FILL[ATTENTION[target.attention].tone]
        )}
      />
      <span className='flex min-w-0 items-center gap-1.5'>
        <FilePath path={target.file} />
        <span className='shrink-0 text-2xs text-fg-2'>{formatTargetLines(target)}</span>
      </span>
      {target.why && <span className='text-fg-3 text-xs'>{target.why}</span>}
      {showSection && <span className='text-2xs text-fg-2'>{target.section}</span>}
    </button>
  );
}

function SideHeading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <SectionLabel count={count} className='mt-3 px-2'>
      {children}
    </SectionLabel>
  );
}

function Walkthrough({
  report,
  order,
  selectedKey,
  findings,
  onSelect,
}: {
  report: WorkReport;
  order: ReviewOrder;
  selectedKey: string | null;
  findings: ReviewTarget[];
  onSelect: (target: ReviewTarget) => void;
}) {
  return (
    <>
      {order === 'walkthrough' ? (
        <ol className='flex flex-col gap-3'>
          {report.sections.map((section, sectionIndex) => (
            <li key={section.title} className='flex flex-col gap-1'>
              <div className='flex gap-2 px-2'>
                <StepNumber index={sectionIndex} />
                <div className='flex min-w-0 flex-col gap-px'>
                  <span className='font-medium text-fg-4 text-xs'>{section.title}</span>
                  <p className='text-2xs text-fg-2'>{section.summary}</p>
                </div>
              </div>
              <div className='flex flex-col gap-px pl-4.5'>
                {section.spots.map((spot, spotIndex) => {
                  const target = toReviewTarget(spot, section.title, `${sectionIndex}:${spotIndex}`);
                  return (
                    <SpotButton
                      key={target.key}
                      target={target}
                      selected={selectedKey === target.key}
                      showSection={false}
                      onSelect={() => onSelect(target)}
                    />
                  );
                })}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className='flex flex-col gap-px'>
          {listReviewTargets(report, 'attention').map((target) => (
            <SpotButton
              key={target.key}
              target={target}
              selected={selectedKey === target.key}
              showSection
              onSelect={() => onSelect(target)}
            />
          ))}
        </div>
      )}
      {findings.length > 0 && (
        <>
          <SideHeading count={findings.length}>Agent review · a signal, not an approval</SideHeading>
          <div className='flex flex-col gap-px'>
            {findings.map((target) => (
              <SpotButton
                key={target.key}
                target={target}
                selected={selectedKey === target.key}
                showSection={false}
                onSelect={() => onSelect(target)}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function JudgementCalls({
  report,
  onSelect,
}: {
  report: WorkReport;
  onSelect: (file: string, line: number) => void;
}) {
  if (report.judgementCalls.length === 0) return null;
  return (
    <>
      <SideHeading count={report.judgementCalls.length}>Judgement calls</SideHeading>
      <ul className='flex flex-col gap-2 px-2'>
        {report.judgementCalls.map(({ call, reason, file, line }) => (
          <li key={call} className='flex flex-col gap-px text-xs'>
            <span className='font-medium text-fg-4'>{call}</span>
            <span className='text-fg-2'>{reason}</span>
            {file && (
              <button
                type='button'
                onClick={() => onSelect(file, line ?? 1)}
                className='mt-0.5 w-fit cursor-pointer text-2xs text-primary-text hover:underline active:underline'
              >
                {describeFindingPlace({ file, line })}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Checks({ report }: { report: WorkReport }) {
  if (report.checks.length === 0) return null;
  return (
    <>
      <SideHeading>Checks the agent ran</SideHeading>
      <ul className='flex flex-col gap-1 px-2'>
        {report.checks.map((check) => (
          <li key={check.name} className='flex items-center gap-2 text-xs'>
            <CheckOutcomeIcon outcome={check.outcome} />
            <span className='text-2xs text-fg-4'>{check.name}</span>
            {check.detail && <Truncate className='text-2xs text-fg-2'>{check.detail}</Truncate>}
          </li>
        ))}
      </ul>
    </>
  );
}

function Comments() {
  const draft = useReviewDraft();
  if (draft.comments.length === 0) return null;
  return (
    <>
      <SideHeading count={draft.comments.length}>Your comments</SideHeading>
      <ul className='flex flex-col gap-2 px-2'>
        {draft.comments.map((comment) => (
          <li key={comment.id} className='flex flex-col gap-px text-xs'>
            <span className='text-2xs text-fg-2'>
              {describeFindingPlace({ file: comment.path, line: comment.line })}
            </span>
            <span className='text-fg-4'>{comment.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function ReviewSummary({
  task,
  headline,
  order,
  onOrder,
}: {
  task: Task;
  headline: string;
  order: ReviewOrder;
  onOrder: (order: ReviewOrder) => void;
}) {
  return (
    <div className='flex flex-col gap-2.5 border-border border-b p-3'>
      <p className='font-medium text-fg-4 text-xs'>{headline}</p>
      <div className='flex items-center justify-between gap-2'>
        <Choice<ReviewOrder> label='Order' items={REVIEW_ORDERS} value={order} onValueChange={onOrder} />
      </div>
      {!task.report && (
        <p className='text-2xs text-fg-2'>
          This hand-over predates the review protocol, so the spots come from the riskiest hunks.
        </p>
      )}
    </div>
  );
}

function CodePane({
  task,
  diff,
  target,
  index,
  total,
  onStep,
}: {
  task: Task;
  diff: TaskDiff;
  target: ReviewTarget | null;
  index: number;
  total: number;
  onStep: (delta: 1 | -1) => void;
}) {
  const file = target ? diff.files.find((candidate) => candidate.path === target.file) : undefined;
  return (
    <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
      <Toolbar>
        {target ? (
          <>
            <FilePath path={target.file} />
            <span className='shrink-0 text-fg-2 text-xs'>{formatTargetLines(target)}</span>
            <AttentionLabel attention={target.attention} />
          </>
        ) : (
          <span className='text-2xs text-fg-2'>Pick a spot on the left</span>
        )}
        <div className='flex-1' />
        <span className='hidden text-2xs text-fg-2 tabular-nums sm:inline'>
          {total > 0 ? `${index + 1} of ${total}` : ''}
        </span>
        <div className='flex items-center'>
          <Hint label='Previous spot'>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconChevronTopMedium'
              aria-label='Previous spot'
              onClick={() => onStep(-1)}
            />
          </Hint>
          <Hint label='Next spot'>
            <Button
              variant='secondary'
              size='icon-sm'
              icon='IconChevronDownMedium'
              aria-label='Next spot'
              onClick={() => onStep(1)}
            />
          </Hint>
        </div>
        {target && task.worktreePath && (
          <Button
            variant='secondary'
            size='sm'
            icon='IconCode'
            onClick={() => void openWorktree(task.id, 'editor', target.file, target.start)}
          >
            Open
          </Button>
        )}
      </Toolbar>
      {target && !file && (
        <p className='p-3 text-fg-2 text-xs'>
          {target.file} is not part of this change. The agent may have pointed at the wrong file.
        </p>
      )}
      {target && file && (
        <CodeView
          taskId={task.id}
          file={file}
          revision={task.updatedAt}
          mode='focus'
          focus={{ start: target.start, end: target.end, attention: target.attention }}
          markers={listFindingMarkers(task, file.path)}
        />
      )}
    </section>
  );
}

export function ReviewPane({ task, diff }: { task: Task; diff: TaskDiff }) {
  const [order, setOrder] = React.useState<ReviewOrder>('walkthrough');
  const report = React.useMemo(
    () => task.report ?? resolveFallbackReport(diff, task.summary ?? task.title),
    [task.report, task.summary, task.title, diff]
  );
  const findings = React.useMemo(() => listFindingTargets(task.findings), [task.findings]);
  const targets = React.useMemo(
    () => [...listReviewTargets(report, order), ...findings],
    [report, order, findings]
  );
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const [decisionTarget, setDecisionTarget] = React.useState<ReviewTarget | null>(null);
  const selected =
    decisionTarget ?? targets.find((target) => target.key === selectedKey) ?? targets[0] ?? null;
  const index = selected ? targets.findIndex((target) => target.key === selected.key) : -1;

  function select(target: ReviewTarget) {
    setDecisionTarget(null);
    setSelectedKey(target.key);
  }

  function step(delta: 1 | -1) {
    const next = stepTarget(targets, index, delta);
    if (next) select(next);
  }

  return (
    <div className='flex min-h-0 flex-1 max-md:flex-col'>
      <aside className='flex w-85 shrink-0 flex-col border-border border-r max-md:max-h-2/5 max-md:w-full max-md:border-r-0 max-md:border-b max-lg:w-75'>
        <ReviewSummary task={task} headline={report.headline} order={order} onOrder={setOrder} />
        <div className='min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-6'>
          <Walkthrough
            report={report}
            order={order}
            selectedKey={decisionTarget ? null : (selected?.key ?? null)}
            findings={findings}
            onSelect={select}
          />
          <JudgementCalls
            report={report}
            onSelect={(file, line) => setDecisionTarget(createDecisionTarget(file, line))}
          />
          <Checks report={report} />
          <Comments />
        </div>
      </aside>
      <CodePane
        task={task}
        diff={diff}
        target={selected}
        index={index}
        total={targets.length}
        onStep={step}
      />
    </div>
  );
}
