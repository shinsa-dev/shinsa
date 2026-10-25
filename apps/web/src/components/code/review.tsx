import type { Task, WorkReport } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { FilePath } from '@/components/text/file-path.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import { TONE_FILL } from '@/lib/format/tone.ts';
import { describeCommentPlace } from '@/lib/review/draft.ts';
import { describeFindingPlace } from '@/lib/review/findings.ts';
import {
  formatTargetLines,
  listReviewTargets,
  REVIEW_ORDERS,
  type ReviewOrder,
  type ReviewTarget,
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
        'corner-superellipse/1.125 relative flex w-full cursor-pointer flex-col gap-px rounded-control-sm py-1 pr-1.5 pl-3.5 text-left outline-none transition-colors duration-100',
        selected ? 'bg-primary-a1' : 'hover:bg-bg-a2 active:bg-bg-a2'
      )}
    >
      <span
        className={cn(
          'absolute inset-y-1.5 left-1.5 w-0.5 rounded-full',
          TONE_FILL[ATTENTION[target.attention].tone]
        )}
      />
      <span className='flex h-4 min-w-0 items-center gap-1.5'>
        <Icon name={resolveFileIcon(target.file)} size='sm' />
        <FilePath path={target.file} />
        <span className='shrink-0 text-2xs text-fg-2'>{formatTargetLines(target)}</span>
      </span>
      {target.why && <span className='text-2xs text-fg-3'>{target.why}</span>}
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
        <ol className='flex flex-col gap-2.5'>
          {report.sections.map((section, sectionIndex) => (
            <li key={section.title} className='flex flex-col gap-1'>
              <div className='flex gap-2 px-2'>
                <StepNumber index={sectionIndex} />
                <div className='flex min-w-0 flex-col gap-px'>
                  <span className='font-medium text-fg-4 text-xs'>{section.title}</span>
                  <p className='text-2xs text-fg-2'>{section.summary}</p>
                </div>
              </div>
              <div className='flex flex-col pl-4.5'>
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
        <div className='flex flex-col'>
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
          <div className='flex flex-col'>
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

function Comments({ onSelect }: { onSelect: (path: string, line: number, side: 'old' | 'new') => void }) {
  const draft = useReviewDraft();
  if (draft.comments.length === 0) return null;
  return (
    <>
      <SideHeading count={draft.comments.length}>Your comments</SideHeading>
      <ul className='flex flex-col gap-2 px-2'>
        {draft.comments.map((comment) => (
          <li key={comment.id} className='flex flex-col gap-px text-xs'>
            <button
              type='button'
              onClick={() => onSelect(comment.path, comment.line, comment.side)}
              className='w-fit cursor-pointer text-left text-2xs text-primary-text hover:underline active:underline'
            >
              {describeCommentPlace(comment)}
            </button>
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
          The agent handed over no report, so Shinsa picked these spots from the riskiest changes.
        </p>
      )}
    </div>
  );
}

export function ReviewExplorer({
  task,
  report,
  findings,
  order,
  selectedKey,
  onOrder,
  onSelect,
  onSelectLine,
}: {
  task: Task;
  report: WorkReport;
  findings: ReviewTarget[];
  order: ReviewOrder;
  selectedKey: string | null;
  onOrder: (order: ReviewOrder) => void;
  onSelect: (target: ReviewTarget) => void;
  onSelectLine: (path: string, line: number, side: 'old' | 'new') => void;
}) {
  return (
    <div className='flex flex-col'>
      <ReviewSummary task={task} headline={report.headline} order={order} onOrder={onOrder} />
      <div className='px-1 pt-2 pb-6'>
        <Walkthrough
          report={report}
          order={order}
          selectedKey={selectedKey}
          findings={findings}
          onSelect={onSelect}
        />
        <JudgementCalls report={report} onSelect={(file, line) => onSelectLine(file, line, 'new')} />
        <Checks report={report} />
        <Comments onSelect={onSelectLine} />
      </div>
    </div>
  );
}
