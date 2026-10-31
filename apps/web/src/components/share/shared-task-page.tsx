import { type DiffFile, serializePlanMarkdown, type Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { Choice } from '@/components/controls/choice.tsx';
import { ErrorBoundary } from '@/components/errors/boundary.tsx';
import { EvidenceSection } from '@/components/evidence/evidence-section.tsx';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { ResultPanel } from '@/components/overview/result-panel.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { FACT } from '@/components/task/fact.ts';
import { TaskHeading } from '@/components/task/heading.tsx';
import { ReviewDraftProvider } from '@/components/task/review-draft.tsx';
import { CodeDiff } from '@/components/text/code-diff.tsx';
import { Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { resolveFileSource } from '@/lib/code/diff-view.ts';
import { useTaskDiff, useTaskRefs } from '@/lib/connection/code.ts';
import { STAGE_TONE } from '@/lib/format/labels.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveOverviewPanelId } from '@/lib/preferences/disclosure.ts';
import {
  describeSharedBy,
  listSharedTabs,
  NO_PLAN_YET,
  resolveSharedTab,
  SHARED_TAB_LABEL,
  type SharedTab,
} from '@/lib/share/page.ts';
import type { SharedView } from '@/lib/share/view.ts';
import { describePullRequestFact } from '@/lib/tasks/facts.ts';
import { resolvePullRequestTone } from '@/lib/tasks/pull-request.ts';
import { resolveStageLabel, resolveTaskStatusIcon } from '@/lib/tasks/status.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';
import { ReviewTab } from '@/routes/task/review.tsx';

function SharedFacts({ view }: { view: SharedView }) {
  const { task, shared } = view;
  const pullRequest = task.pullRequest;
  const prTone = pullRequest ? TONE_TEXT[resolvePullRequestTone(pullRequest)] : '';
  return (
    <div className='-ms-1.5 flex flex-wrap items-center gap-1'>
      {task.handle && <span className={cn(FACT, 'tabular-nums')}>{task.handle}</span>}
      <span className={FACT}>
        <Icon
          size='sm'
          name={resolveTaskStatusIcon(view.state, task)}
          className={TONE_TEXT[STAGE_TONE[task.stage]]}
        />
        <span className='font-medium'>{resolveStageLabel(task)}</span>
      </span>
      {shared.project && (
        <span className={FACT}>
          <Icon size='sm' name='IconFolder1' />
          <span className='truncate'>{shared.project}</span>
        </span>
      )}
      {shared.repository && (
        <span className={FACT}>
          <Icon size='sm' name='IconGithub' />
          <span className='truncate'>{shared.repository}</span>
        </span>
      )}
      {pullRequest && (
        <a
          href={pullRequest.url || undefined}
          target='_blank'
          rel='noreferrer'
          className={cn(FACT, pullRequest.url && 'hover:text-fg-4 active:text-fg-4')}
        >
          <Icon size='sm' name='IconPullRequest' className={prTone} />
          <span className={cn('tabular-nums', prTone)}>#{pullRequest.number}</span>
          {describePullRequestFact(pullRequest).map((note) => (
            <span key={note.text} className={TONE_TEXT[note.tone]}>
              {note.text}
            </span>
          ))}
        </a>
      )}
      <span className={FACT}>
        <Icon size='sm' name='IconShareOs' />
        <span className='truncate'>{describeSharedBy(shared)}</span>
        <TimeAgo at={view.updatedAt} />
      </span>
    </div>
  );
}

function SharedOverview({ view }: { view: SharedView }) {
  const { task, state } = view;
  const plan = task.plan?.document ?? null;
  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
        <ResultPanel task={task} />
        {task.summary && (
          <Panel persistId={resolveOverviewPanelId(task, 'summary')} title='Summary' icon='IconNote1'>
            <Markdown text={task.summary} className='selectable text-fg-4' />
          </Panel>
        )}
        <Panel persistId={resolveOverviewPanelId(task, 'plan')} title='Plan' icon='IconChecklist'>
          {plan ? (
            <Markdown text={serializePlanMarkdown(plan)} className='selectable text-fg-4' />
          ) : (
            <p className='text-fg-2 text-xs'>{NO_PLAN_YET}</p>
          )}
        </Panel>
        <EvidenceSection state={state} task={task} />
      </div>
    </PageScroll>
  );
}

function SharedFileDiff({ file }: { file: DiffFile }) {
  return (
    <section className='flex flex-col gap-1.5'>
      <h3 className='selectable truncate font-mono text-fg-3 text-xs'>{file.path}</h3>
      <CodeDiff source={resolveFileSource(file)} numbered />
    </section>
  );
}

function SharedCode({ task }: { task: Task }) {
  const refs = useTaskRefs(task);
  const ready = refs.status === 'ready' ? refs.value : null;
  const diff = useTaskDiff(task, ready?.base ?? null, ready?.head ?? null);
  const failure = refs.status === 'error' ? refs : diff.status === 'error' ? diff : null;
  return (
    <PageScroll>
      <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
        {failure && <p className='text-fg-2 text-xs'>{failure.message}</p>}
        {!failure && diff.status !== 'ready' && <LoadingLine label='Reading the changes' />}
        {diff.status === 'ready' &&
          diff.value.files.map((file) => <SharedFileDiff key={file.path} file={file} />)}
      </div>
    </PageScroll>
  );
}

function SharedTabContent({ view, tab }: { view: SharedView; tab: SharedTab }) {
  switch (tab) {
    case 'overview':
      return <SharedOverview view={view} />;
    case 'review':
      return <ReviewTab state={view.state} task={view.task} readOnly />;
    case 'code':
      return <SharedCode task={view.task} />;
  }
}

export function SharedTaskPage({ view, note }: { view: SharedView; note: string }) {
  const tabs = listSharedTabs(view.task, view.shared);
  const tab = resolveSharedTab(tabs, useSearchParam('tab'));
  return (
    <ReviewDraftProvider enabled={false} draftKey={`shared:${view.task.id}`}>
      <div className='flex min-h-0 flex-1 flex-col'>
        <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex shrink-0 flex-col gap-2.5 pb-1')}>
          <p className='flex items-center gap-1.5 text-fg-2 text-xs'>
            <Icon size='sm' name='IconEyeOpen' />
            {note}
          </p>
          <div className='flex flex-wrap items-start gap-x-4 gap-y-2'>
            <TaskHeading task={view.task} className='min-w-60 flex-1 py-0.5' />
            {tabs.length > 1 && (
              <Choice
                label='Task view'
                items={tabs.map((value) => ({ value, label: SHARED_TAB_LABEL[value] }))}
                value={tab}
                onValueChange={(next) => updateSearchParams({ tab: next === 'overview' ? null : next })}
                className='shrink-0'
              />
            )}
          </div>
          <SharedFacts view={view} />
        </div>
        <ErrorBoundary size='inline' resetKey={tab} className={cn(PAGE_COLUMN, 'py-5')}>
          <SharedTabContent view={view} tab={tab} />
        </ErrorBoundary>
      </div>
    </ReviewDraftProvider>
  );
}
