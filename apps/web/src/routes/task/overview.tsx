import type { Gate, ShinsaState, Task } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { PAGE_COLUMN } from '@/components/layout/page/column.ts';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { CHIP } from '@/components/layout/surface/card.ts';
import { Panel } from '@/components/layout/surface/panel.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { ActivityRow } from '@/components/overview/activity-row.tsx';
import { CodeSnippet } from '@/components/overview/code-snippet.tsx';
import { DelegationsPanel } from '@/components/overview/delegations-panel.tsx';
import { EvidenceItem } from '@/components/overview/evidence-item.tsx';
import { NowCard } from '@/components/overview/now-card.tsx';
import { ResultPanel } from '@/components/overview/result-panel.tsx';
import { RoundsPanel } from '@/components/overview/rounds-panel.tsx';
import { SuggestionsPanel } from '@/components/overview/suggestions-panel.tsx';
import { Composer } from '@/components/task/composer.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { listActivityNewestFirst, resolveOverviewSummary } from '@/lib/overview/activity.ts';
import { isVisualEvidence, listRoundEvidence } from '@/lib/overview/evidence.ts';
import { isResultInNowCard, type NowTarget } from '@/lib/overview/now.ts';
import { describeFindingPlace } from '@/lib/review/findings.ts';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
import { isCodeTask } from '@/lib/tasks/shapes.ts';

const SPOTS_SHOWN = 2;

function EvidencePanel({ state, task }: { state: ShinsaState; task: Task }) {
  const evidence = listRoundEvidence(state.evidence, task);
  if (evidence.length === 0) return null;
  const visuals = evidence.filter((item) => isVisualEvidence(item.uri));
  const others = evidence.filter((item) => !isVisualEvidence(item.uri));
  return (
    <Panel title='Evidence' icon='IconImages1'>
      {visuals.length > 0 && (
        <div className='grid gap-3 sm:grid-cols-2'>
          {visuals.map((item) => (
            <EvidenceItem key={item.id} evidence={item} />
          ))}
        </div>
      )}
      {others.map((item) => (
        <EvidenceItem key={item.id} evidence={item} />
      ))}
    </Panel>
  );
}

function ChangesPanel({ task, onOpen }: { task: Task; onOpen: (target: NowTarget) => void }) {
  const sections = task.report?.sections ?? [];
  if (sections.length === 0) return null;
  return (
    <Panel
      title='What changed'
      icon='IconCodeLines'
      action={
        <Button variant='link' size='sm' onClick={() => onOpen('review')}>
          Review the code
        </Button>
      }
    >
      <ol className='flex flex-col gap-4'>
        {sections.map((section, index) => (
          <li key={section.title} className='flex gap-2.5'>
            <StepNumber index={index} />
            <div className='flex min-w-0 flex-1 flex-col gap-2'>
              <div className='flex flex-col gap-px'>
                <InlineMarkdown text={section.title} className='font-medium text-fg-4 text-xs leading-5' />
                <Markdown text={section.summary} className='text-fg-3 text-xs' />
              </div>
              {section.spots.slice(0, SPOTS_SHOWN).map((spot) => (
                <CodeSnippet key={`${spot.file}:${spot.start}`} task={task} spot={spot} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function JudgementCallsPanel({ task }: { task: Task }) {
  const calls = task.report?.judgementCalls ?? [];
  if (calls.length === 0) return null;
  return (
    <Panel title='Judgement calls' icon='IconSplit'>
      <ul className='flex flex-col divide-y divide-border'>
        {calls.map((call) => (
          <li key={call.call} className='flex gap-2.5 py-2 first:pt-0 last:pb-0'>
            <Icon size='sm' name='IconSplit' className='mt-0.5' />
            <div className='flex min-w-0 flex-1 flex-col gap-px'>
              <InlineMarkdown text={call.call} className='font-medium text-fg-4 text-xs leading-5' />
              <Markdown text={call.reason} className='text-fg-3 text-xs' />
              {call.file && (
                <code className={cn(CHIP, 'mt-0.5 font-mono text-2xs')}>{describeFindingPlace(call)}</code>
              )}
            </div>
          </li>
        ))}
      </ul>
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
  const hint = resolveMessageHint(state, task);
  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <PageScroll>
        <div className={cn(PAGE_COLUMN, 'flex flex-col gap-5 py-5')}>
          <NowCard key={gate?.id ?? 'now'} state={state} task={task} gate={gate} onOpen={onOpen} />
          {!isResultInNowCard(state, task, gate) && <ResultPanel task={task} />}
          <DelegationsPanel state={state} task={task} onOpen={(runId) => onOpen('agent', runId)} />
          <SuggestionsPanel task={task} />
          {code && (
            <Panel title='Summary' icon='IconNote1'>
              {summary ? (
                <Markdown text={summary} className='text-fg-4' />
              ) : (
                <p className='text-fg-2 text-xs'>
                  No summary yet. It appears once an agent hands over its work.
                </p>
              )}
            </Panel>
          )}
          <EvidencePanel state={state} task={task} />
          {code && <ChangesPanel task={task} onOpen={onOpen} />}
          {code && <JudgementCallsPanel task={task} />}
          <RoundsPanel state={state} task={task} onOpen={(runId) => onOpen('agent', runId)} />
          <Panel title='Activity' icon='IconClock'>
            <ol className='flex flex-col'>
              {listActivityNewestFirst(task).map((entry) => (
                <ActivityRow
                  key={`${entry.at}-${entry.kind}-${entry.text}`}
                  entry={entry}
                  state={state}
                  onOpenRun={(runId) => onOpen('agent', runId)}
                />
              ))}
            </ol>
          </Panel>
        </div>
      </PageScroll>
      {hint && (
        <Composer
          placeholder={hint.placeholder}
          submitLabel='Send message'
          onSubmit={(text) => sendTaskMessage(task, hint, text)}
        />
      )}
    </div>
  );
}
