import type { TaskDiff } from '@shinsa/core';
import {
  type Gate,
  hasStep,
  listMergeSteps,
  listOpenGates,
  type ShinsaState,
  type Task,
  type WorkReport,
} from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { MessageQueue } from '@/components/chat/message-queue.tsx';
import { EvidenceSection } from '@/components/evidence/evidence-section.tsx';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { SectionLabel } from '@/components/layout/page/section-label.tsx';
import { SKIPPED_OFFSCREEN_POINT, SKIPPED_OFFSCREEN_ROW } from '@/components/layout/surface/offscreen.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { Eyebrow, NowFrame } from '@/components/overview/now-frame.tsx';
import { ReviewActions } from '@/components/overview/review-actions.tsx';
import { MergeStepsPanel } from '@/components/review/merge-steps.tsx';
import { REVIEW_SELECTED, ReviewNote } from '@/components/review/note.tsx';
import { PointIndex } from '@/components/review/point-index.tsx';
import { TestingPanel } from '@/components/review/testing.tsx';
import { FindingVerdictChoice } from '@/components/review/verdict-choice.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { prepareCodeDiff } from '@/components/text/code-diff.tsx';
import { DiffStats } from '@/components/text/diff-stats.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { useReviewKeys } from '@/hooks/use-review-keys.ts';
import { useStructuralValue } from '@/hooks/use-structural-value.ts';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listReviewCommands } from '@/lib/command/review.ts';
import { type Loaded, useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import { describeEscalationBody } from '@/lib/overview/verdicts.ts';
import { createDisclosureId, notPersisted } from '@/lib/preferences/disclosure.ts';
import { resolveFallbackReport } from '@/lib/review/fallback-report.ts';
import { resolveReviewItemIdentity } from '@/lib/review/identity.ts';
import type { ReviewStep } from '@/lib/review/keys.ts';
import { listMergeWaits, type MergeWaitView } from '@/lib/review/merge-steps.ts';
import {
  describeAgentReview,
  describeItemPlace,
  describePointCount,
  listOtherFiles,
  listReviewChapters,
  listReviewPoints,
  listReviewStops,
  REVIEW_PROSE_ICON,
  REVIEW_PROSE_TITLE,
  type ReviewChapter,
  type ReviewItem,
  type ReviewProseId,
  type ReviewStop,
  resolveStopInView,
  stepReviewItem,
  toCommentItem,
  toFindingItem,
} from '@/lib/review/report.ts';
import {
  type ReviewSelection,
  useReviewSelection,
  useSelectionRequest,
  useStopLit,
} from '@/lib/review/selection.ts';
import { type ChecksView, resolveChecksView } from '@/lib/tasks/checks.ts';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
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

function skipFailure() {
  return null;
}

function prepareReviewSnippets(items: readonly ReviewItem[]) {
  const paths = items.flatMap((item) => (item.place ? [item.place.file] : []));
  if (paths.length > 0) void prepareCodeDiff(paths).then(undefined, skipFailure);
}

const HOLD_MS = 1_200;

const HOLD_STEP_MS = 100;

const IN_VIEW_LINE = 48;

const LETTING_GO = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

function useHoldPointInView(
  viewport: React.RefObject<HTMLDivElement | null>,
  selection: ReviewSelection,
  selected: string | null,
  request: number
) {
  React.useEffect(() => {
    if (!selected) return;
    void request;
    const find = () => viewport.current?.querySelector(`[data-review-item="${CSS.escape(selected)}"]`);
    let held = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const letGo = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      selection.holding = false;
    };
    const hold = () => {
      find()?.scrollIntoView?.({ block: 'start' });
      held += HOLD_STEP_MS;
      timer = setTimeout(held < HOLD_MS ? hold : letGo, HOLD_STEP_MS);
    };
    selection.holding = true;
    hold();
    for (const name of LETTING_GO) window.addEventListener(name, letGo, { once: true, passive: true });
    return () => {
      letGo();
      for (const name of LETTING_GO) window.removeEventListener(name, letGo);
    };
  }, [viewport, selection, selected, request]);
}

function FollowSpot({
  viewport,
  selection,
}: {
  viewport: React.RefObject<HTMLDivElement | null>;
  selection: ReviewSelection;
}) {
  const spot = useSearchParam('spot');
  const request = useSelectionRequest(selection);
  React.useEffect(() => {
    if (spot) selection.writeCurrent(spot);
  }, [selection, spot]);
  React.useEffect(() => {
    void request;
    selection.light(spot);
  }, [selection, spot, request]);
  useHoldPointInView(viewport, selection, spot, request);
  return null;
}

function useStopInView(
  viewport: React.RefObject<HTMLDivElement | null>,
  stops: readonly ReviewStop[],
  selection: ReviewSelection
) {
  React.useEffect(() => {
    const scroller = viewport.current;
    if (!scroller) return;
    const keys = new Set(stops.map((stop) => stop.key));
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (selection.holding) return;
      const box = scroller.getBoundingClientRect();
      const marks = [...scroller.querySelectorAll<HTMLElement>('[data-review-item]')].flatMap((element) => {
        const key = element.dataset.reviewItem ?? '';
        return keys.has(key) ? [{ key, top: element.getBoundingClientRect().top - box.top }] : [];
      });
      const end = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      selection.writeCurrent(resolveStopInView(marks, IN_VIEW_LINE, end ? scroller.clientHeight : null));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [viewport, stops, selection]);
}

function resolveReviewDisclosure(task: Task, ...parts: string[]) {
  return createDisclosureId('task', task.id, 'review', ...parts);
}

function Chapter({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className='flex flex-col gap-1'>
      <SectionLabel count={count}>{title}</SectionLabel>
      <div className='flex flex-col gap-2'>{children}</div>
    </section>
  );
}

function Stop({
  stop,
  selection,
  children,
}: {
  stop: string;
  selection: ReviewSelection;
  children: React.ReactNode;
}) {
  const lit = useStopLit(selection, stop);
  return (
    <div
      data-review-item={stop}
      data-selected={lit || undefined}
      className={cn(
        'corner-superellipse/1.125 scroll-my-6 rounded-xl',
        REVIEW_SELECTED,
        SKIPPED_OFFSCREEN_POINT
      )}
    >
      {children}
    </div>
  );
}

function Prose({ text, className }: { text: string; className?: string }) {
  return <Markdown text={text} className={cn('text-fg-4 text-xs', className)} />;
}

function BuiltPart({
  task,
  report,
  checks,
  waits,
  prose,
}: {
  task: Task;
  report: WorkReport;
  checks: ChecksView | null;
  waits: MergeWaitView[];
  prose: ReviewProseId;
}) {
  const walkthrough = report.walkthrough;
  switch (prose) {
    case 'approach':
    case 'flow':
      return (
        <Panel
          persistId={resolveReviewDisclosure(task, 'panel', prose)}
          title={REVIEW_PROSE_TITLE[prose]}
          icon={REVIEW_PROSE_ICON[prose]}
        >
          <Prose text={walkthrough?.[prose] ?? ''} />
        </Panel>
      );
    case 'testing':
      return (
        <TestingPanel
          persistId={resolveReviewDisclosure(task, 'panel', prose)}
          task={task}
          testing={walkthrough?.testing ?? null}
          checks={checks}
          coverage={task.coverage}
        />
      );
    case 'pre_merge':
    case 'post_merge':
      return (
        <MergeStepsPanel
          persistId={resolveReviewDisclosure(task, 'panel', prose)}
          task={task}
          when={prose}
          waits={waits}
        />
      );
  }
}

function HowItIsBuilt({
  task,
  report,
  checks,
  waits,
  chapter,
  selection,
}: {
  task: Task;
  report: WorkReport;
  checks: ChecksView | null;
  waits: MergeWaitView[];
  chapter: ReviewChapter;
  selection: ReviewSelection;
}) {
  return (
    <Chapter title={chapter.title}>
      {chapter.prose.map((prose) => (
        <Stop key={prose.key} stop={prose.key} selection={selection}>
          <BuiltPart task={task} report={report} checks={checks} waits={waits} prose={prose.key} />
        </Stop>
      ))}
    </Chapter>
  );
}

function LitNote({
  selection,
  persistId,
  ...note
}: Omit<React.ComponentProps<typeof ReviewNote>, 'selected'> & { selection: ReviewSelection }) {
  const lit = useStopLit(selection, note.item.key);
  return <ReviewNote persistId={persistId} {...note} selected={lit} />;
}

function PointCard({
  task,
  item,
  selection,
  className,
}: {
  task: Task;
  item: ReviewItem;
  selection: ReviewSelection;
  className?: string;
}) {
  return (
    <LitNote
      persistId={resolveReviewDisclosure(task, 'card', resolveReviewItemIdentity(item))}
      task={task}
      item={item}
      selection={selection}
      className={cn(SKIPPED_OFFSCREEN_POINT, className)}
      action={<FindingVerdictChoice task={task} finding={item.finding} />}
    />
  );
}

function RiskRow({ task, item, selection }: { task: Task; item: ReviewItem; selection: ReviewSelection }) {
  const place = item.place;
  const lit = useStopLit(selection, item.key);
  return (
    <li
      data-review-item={item.key}
      data-selected={lit || undefined}
      className={cn(
        'corner-superellipse/1.125 flex scroll-my-6 flex-col gap-2 rounded-lg p-1.5 transition-[background-color] duration-500 data-selected:bg-primary-a1',
        SKIPPED_OFFSCREEN_ROW
      )}
    >
      {item.title && <span className='font-medium text-fg-4 text-xs leading-5'>{item.title}</span>}
      <Prose text={item.body} />
      {place && task.repoId && (
        <ChangeSnippet
          persistId={resolveReviewDisclosure(task, 'risk', resolveReviewItemIdentity(item), 'snippet')}
          task={task}
          path={place.file}
          start={place.start}
          end={place.end}
          spot={item.key}
          startsOpen
        />
      )}
      {place && !task.repoId && (
        <span className='text-2xs'>
          <FileLink task={task} path={place.file} label={describeItemPlace(place)} />
        </span>
      )}
    </li>
  );
}

function ReadCarefully({
  task,
  chapter,
  selection,
}: {
  task: Task;
  chapter: ReviewChapter;
  selection: ReviewSelection;
}) {
  const spots = chapter.items.filter((item) => !item.key.startsWith('risk:'));
  const risks = chapter.items.filter((item) => item.key.startsWith('risk:'));
  return (
    <Chapter title={chapter.title} count={chapter.items.length}>
      {spots.map((item) => (
        <PointCard key={item.key} task={task} item={item} selection={selection} />
      ))}
      {risks.length > 0 && (
        <Panel
          persistId={resolveReviewDisclosure(task, 'panel', 'risks')}
          title='Risks and edge cases'
          icon='IconExclamationTriangle'
          count={risks.length}
        >
          <ul className='-m-1.5 flex flex-col gap-1'>
            {risks.map((item) => (
              <RiskRow key={item.key} task={task} item={item} selection={selection} />
            ))}
          </ul>
        </Panel>
      )}
    </Chapter>
  );
}

function PointCards({
  task,
  chapter,
  selection,
}: {
  task: Task;
  chapter: ReviewChapter;
  selection: ReviewSelection;
}) {
  return (
    <Chapter title={chapter.title} count={chapter.items.length}>
      {chapter.items.map((item) => (
        <PointCard key={item.key} task={task} item={item} selection={selection} />
      ))}
    </Chapter>
  );
}

const AgentReview = React.memo(function AgentReviewPanel({
  task,
  chapter,
  selection,
}: {
  task: Task;
  chapter: ReviewChapter | undefined;
  selection: ReviewSelection;
}) {
  const reviewed = task.reviewSummary !== null;
  if (!chapter && !reviewed && !hasStep(task, 'agent_review')) return null;
  const items = chapter?.items ?? [];
  return (
    <Panel
      persistId={resolveReviewDisclosure(task, 'panel', 'agent-review')}
      title='Agent review'
      icon='IconEyeSparkle'
      count={items.length > 0 ? items.length : undefined}
    >
      {reviewed || chapter ? (
        <div className='flex flex-col gap-1'>
          {task.reviewSummary && <Prose text={task.reviewSummary} />}
          <p className='text-fg-3 text-xs'>
            {describeAgentReview(task.findings)} A signal for you, never the approval.
          </p>
        </div>
      ) : (
        <p className='text-fg-2 text-xs'>The agent review has not run yet.</p>
      )}
      {items.map((item) => (
        <PointCard key={item.key} task={task} item={item} selection={selection} className='rounded-lg' />
      ))}
    </Panel>
  );
});

const Comments = React.memo(function CommentCards({
  task,
  selection,
}: {
  task: Task;
  selection: ReviewSelection;
}) {
  const draft = useReviewDraft();
  if (draft.comments.length === 0) return null;
  return (
    <Chapter title='Your comments' count={draft.comments.length}>
      {draft.comments.map((comment) => {
        const item = toCommentItem(comment);
        return (
          <LitNote
            key={item.key}
            persistId={resolveReviewDisclosure(task, 'card', resolveReviewItemIdentity(item))}
            task={task}
            item={item}
            selection={selection}
            action={
              <button
                type='button'
                className='cursor-pointer text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
                onClick={() => draft.removeComment(comment.id)}
              >
                Remove
              </button>
            }
          />
        );
      })}
    </Chapter>
  );
});

const EverythingElse = React.memo(function EverythingElsePanel({
  task,
  report,
  diff,
}: {
  task: Task;
  report: WorkReport;
  diff: TaskDiff | null;
}) {
  const files = diff ? listOtherFiles(diff.files, report, task.findings) : [];
  const dismissed = task.dismissedFindings ?? [];
  if (files.length === 0 && dismissed.length === 0) return null;
  return (
    <Panel
      persistId={resolveReviewDisclosure(task, 'panel', 'everything-else')}
      title='Everything else'
      icon='IconFiles'
      defaultOpen={false}
    >
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
              persistId={notPersisted('a finding card never folds')}
              item={{ ...toFindingItem(finding, index), key: `dismissed:${index}`, finding: null }}
              compact
            />
          ))}
        </div>
      )}
    </Panel>
  );
});

function ReviewSummary({
  state,
  task,
  gate,
  report,
  points,
  diff,
}: {
  state: ShinsaState;
  task: Task;
  gate: Gate | undefined;
  report: WorkReport;
  points: ReviewItem[];
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
      action={gate && <ReviewActions state={state} task={task} gate={gate} />}
    >
      {gate?.escalation && <p className='text-fg-3 text-xs'>{describeEscalationBody(gate.escalation)}</p>}
      <p className='text-fg-3 text-xs'>{describePointCount(points)}</p>
      {!task.report && (
        <p className='text-2xs text-fg-2'>
          The agent handed over no report, so Shinsa marked the riskiest changes.
        </p>
      )}
      {task.report && !report.walkthrough && (
        <p className='text-2xs text-fg-2'>
          The agent wrote no walkthrough, so the review is its marked points.
        </p>
      )}
    </NowFrame>
  );
}

const ReviewChapters = React.memo(function ReviewChapterList({
  task,
  report,
  checks,
  waits,
  chapters,
  selection,
}: {
  task: Task;
  report: WorkReport;
  checks: ChecksView | null;
  waits: MergeWaitView[];
  chapters: ReviewChapter[];
  selection: ReviewSelection;
}) {
  return chapters.map((chapter) => {
    if (chapter.id === 'built') {
      return (
        <HowItIsBuilt
          key={chapter.id}
          task={task}
          report={report}
          checks={checks}
          waits={waits}
          chapter={chapter}
          selection={selection}
        />
      );
    }
    if (chapter.id === 'careful')
      return <ReadCarefully key={chapter.id} task={task} chapter={chapter} selection={selection} />;
    if (chapter.id === 'review') return null;
    return <PointCards key={chapter.id} task={task} chapter={chapter} selection={selection} />;
  });
});

function ReviewComposer({ state, task }: { state: ShinsaState; task: Task }) {
  const hint = resolveMessageHint(state, task);
  if (!hint) return null;
  return (
    <Composer
      draftKey={task.id}
      placeholder={hint.placeholder}
      submitLabel='Send message'
      onSubmit={(text) => sendTaskMessage(task, hint, text)}
      dock={<MessageQueue state={state} task={task} />}
    />
  );
}

export function ReviewTab({
  state,
  task,
  summary,
}: {
  state: ShinsaState;
  task: Task;
  summary?: React.ReactNode;
}) {
  const diff = useReviewDiff(task);
  const { tasks } = state;
  const waits = useStructuralValue(React.useMemo(() => listMergeWaits({ tasks }, task), [tasks, task]));
  const hasWaits = waits.length > 0;
  const diffValue = diff.status === 'ready' ? diff.value : null;
  const report = React.useMemo(
    () => task.report ?? (diffValue ? resolveFallbackReport(diffValue, task.summary ?? task.title) : null),
    [task.report, task.summary, task.title, diffValue]
  );
  const chapters = React.useMemo(
    () =>
      listReviewChapters(
        report,
        task.findings,
        task.reviewDisagreements,
        listMergeSteps(task),
        task.coverage ?? null,
        hasWaits
      ),
    [report, task, hasWaits]
  );
  const points = React.useMemo(() => listReviewPoints(chapters), [chapters]);
  const { repos, evidence } = state;
  const checks = useStructuralValue(
    React.useMemo(() => resolveChecksView({ repos, evidence }, task), [repos, evidence, task])
  );
  const stops = React.useMemo(() => listReviewStops(chapters), [chapters]);
  const selection = useReviewSelection(new URLSearchParams(location.search).get('spot'));
  const viewport = React.useRef<HTMLDivElement>(null);
  const gate = selectReviewGate(state, task);
  React.useEffect(() => {
    prepareReviewSnippets(points);
  }, [points]);
  const select = (key: string) => {
    selection.writeCurrent(key);
    selection.request();
    updateSearchParams({ spot: key }, { replace: true });
  };
  const step = (delta: ReviewStep) => {
    const next = stepReviewItem(stops, selection.readCurrent(), delta);
    if (next) select(next.key);
  };
  useReviewKeys(step);
  useStopInView(viewport, stops, selection);
  useRegisterCommands([listReviewCommands({ taskId: task.id, count: stops.length, step })]);
  if (!report && diff.status === 'error') {
    return (
      <div className='flex min-h-0 flex-1 flex-col'>
        <PageScroll>
          <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
            <p className='text-fg-2 text-xs'>{diff.message}</p>
            <EvidenceSection state={state} task={task} showEmpty />
          </div>
        </PageScroll>
        <ReviewComposer state={state} task={task} />
      </div>
    );
  }
  if (!report) {
    return (
      <div className={cn(PAGE_COLUMN, 'flex items-center gap-2 py-5 text-fg-2 text-xs')}>
        <LoadingLine label='Reading the changes' />
      </div>
    );
  }
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <FollowSpot viewport={viewport} selection={selection} />
      {stops.length > 0 && (
        <div className={cn(PAGE_COLUMN, 'shrink-0 pt-5 pb-1')}>
          <PointIndex chapters={chapters} stops={stops} selection={selection} onSelect={select} />
        </div>
      )}
      <PageScroll viewportRef={viewport}>
        <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 pt-4 pb-5', stops.length === 0 && 'pt-5')}>
          {summary ?? (
            <ReviewSummary
              state={state}
              task={task}
              gate={gate}
              report={report}
              points={points}
              diff={diffValue}
            />
          )}
          <EvidenceSection state={state} task={task} showEmpty />
          <ReviewChapters
            task={task}
            report={report}
            checks={checks}
            waits={waits}
            chapters={chapters}
            selection={selection}
          />
          <AgentReview
            task={task}
            chapter={chapters.find((chapter) => chapter.id === 'review')}
            selection={selection}
          />
          <Comments task={task} selection={selection} />
          <EverythingElse task={task} report={report} diff={diffValue} />
        </div>
      </PageScroll>
      <ReviewComposer state={state} task={task} />
    </div>
  );
}
