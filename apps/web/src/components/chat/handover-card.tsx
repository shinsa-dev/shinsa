import {
  type ChatToolArgs,
  capitalise,
  type Run,
  resolvePhaseChange,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SuggestedWatchButtons } from '@/components/automations/suggested-watch.tsx';
import { CardLine, ROW_INDENT } from '@/components/chat/chat-line.tsx';
import { ToolRow } from '@/components/chat/tool-group.tsx';
import { CARD, CHAT_INSET, CHIP } from '@/components/layout/surface/card.ts';
import { IconSlot } from '@/components/layout/surface/icon-slot.tsx';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { InAppLink } from '@/components/links/link.tsx';
import { PlanParameterList } from '@/components/overview/plan-parameters.tsx';
import { PlanChangeSummary, PlanPhaseTitle } from '@/components/overview/plan-revision.tsx';
import { ChangeSnippet } from '@/components/text/change-snippet.tsx';
import { FindingText } from '@/components/text/finding-text.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import {
  hasHandOverWalkthrough,
  readHandOverSpots,
  readPlanParameters,
  readProposedChange,
  resolveAskAnswer,
  resolveAskMeta,
  resolveSpotsMeta,
} from '@/lib/chat/handover.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { readList, readString, readStrings } from '@/lib/chat/tool-describe.ts';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { formatCount } from '@/lib/format/count.ts';
import { listRevisionChanges } from '@/lib/overview/plan-version.ts';
import { resolveTaskDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeReportedFindings, readReportedFindings } from '@/lib/review/findings.ts';
import { resolveReviewPath } from '@/lib/review/places.ts';
import { describeSteps } from '@/lib/tasks/shapes.ts';
import {
  describeSuggestionDetail,
  describeSuggestionStatus,
  selectCallSuggestion,
} from '@/lib/watch-suggestions.ts';
import { resolveAutomationPath } from '@/router.ts';

function Card({
  icon,
  title,
  meta,
  children,
}: {
  icon: IconName;
  title: string;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section data-message className={cn(CARD, 'flex min-w-0 flex-col overflow-hidden')}>
      <CardLine icon={icon} title={title} meta={meta} />
      {children && <div className='flex min-w-0 flex-col gap-3 border-border border-t p-3'>{children}</div>}
    </section>
  );
}

function PlanCard({ args, task }: { args: ChatToolArgs; task: Task | null }) {
  const goal = readString(args, 'goal');
  const phases = readList(args, 'phases');
  const changed = readString(args, 'change_summary');
  const changes = listRevisionChanges(task, changed);
  return (
    <Card
      icon='IconMap'
      title={changed ? 'Revised the plan' : 'Proposed the plan'}
      meta={phases.length > 0 ? formatCount(phases.length, 'phase', 'phases') : null}
    >
      <PlanChangeSummary summary={changed} />
      {goal && <Markdown text={goal} />}
      {phases.length > 0 && (
        <ol className='flex flex-col gap-2'>
          {phases.map((phase, index) => {
            const title = readString(phase, 'title') ?? `Phase ${index + 1}`;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: plan phases are positional
              <li key={index} className='flex gap-2.5'>
                <StepNumber index={index} />
                <div className='flex min-w-0 flex-col gap-px'>
                  <PlanPhaseTitle title={title} change={resolvePhaseChange(changes, title)} />
                  {readString(phase, 'detail') && (
                    <span className='selectable text-fg-3 text-xs'>
                      <InlineMarkdown text={readString(phase, 'detail') ?? ''} />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <PlanParameterList document={readPlanParameters(args)} headingClassName='text-2xs text-fg-2' />
    </Card>
  );
}

function SpotList({ task, args }: { task: Task | null; args: ChatToolArgs }) {
  const spots = readHandOverSpots(args);
  if (!task?.repoId || spots.length === 0) return null;
  return (
    <div className='flex flex-col gap-1.5'>
      <span className='text-2xs text-fg-2'>Spots to review</span>
      {spots.map((spot) => (
        <ChangeSnippet
          key={`${spot.file}:${spot.start}`}
          persistId={resolveTaskDisclosureId(task.id, 'handover', 'spot', spot.file, String(spot.start))}
          task={task}
          path={spot.file}
          start={spot.start}
          end={spot.end}
          why={spot.why}
        />
      ))}
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  args,
  meta,
  task = null,
}: {
  icon: IconName;
  title: string;
  args: ChatToolArgs;
  meta?: React.ReactNode;
  task?: Task | null;
}) {
  const summary = readString(args, 'summary');
  const calls = readList(args, 'judgement_calls');
  return (
    <Card icon={icon} title={title} meta={meta}>
      {summary && <Markdown text={summary} />}
      {calls.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <span className='text-2xs text-fg-2'>Judgement calls</span>
          <ul className='flex flex-col gap-1.5'>
            {calls.map((call, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: judgement calls are positional
              <li key={index} className='flex gap-1.25 text-xs leading-5'>
                <IconSlot>
                  <Icon size='sm' name='IconLightbulbGlow' className='text-fg-4' />
                </IconSlot>
                <span className='selectable min-w-0'>
                  {readString(call, 'title') && (
                    <span className='font-medium text-fg-4'>
                      <InlineMarkdown text={readString(call, 'title') ?? ''} />
                      {': '}
                    </span>
                  )}
                  <span className='text-fg-4'>
                    <InlineMarkdown text={readString(call, 'call') ?? ''} />
                  </span>{' '}
                  {readString(call, 'reason') && (
                    <span className='text-fg-3'>
                      <InlineMarkdown text={readString(call, 'reason') ?? ''} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SpotList task={task} args={args} />
      {task && hasHandOverWalkthrough(args) && (
        <InAppLink
          path={resolveReviewPath(task)}
          className='w-fit font-medium text-primary-text text-xs hover:opacity-80 active:opacity-80'
        >
          Read the walkthrough
        </InAppLink>
      )}
    </Card>
  );
}

function ReviewCard({ args, task }: { args: ChatToolArgs; task: Task | null }) {
  const findings = readReportedFindings(args);
  const { title, meta } = describeReportedFindings(findings);
  if (findings.length === 0) return <Card icon='IconShieldCheck' title={title} />;
  return (
    <Card icon='IconShieldCheck' title={title} meta={meta}>
      <ul className='flex flex-col gap-2.5'>
        {findings.map((finding, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings are positional
          <li key={index} className='flex'>
            <FindingText finding={finding} task={task} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AskCard({ call, args, delegated }: { call: ToolCall; args: ChatToolArgs; delegated: boolean }) {
  const context = readString(args, 'context');
  const choices = readStrings(args, 'choices');
  const answer = resolveAskAnswer(call);
  return (
    <Card
      icon='IconBubbleQuestion'
      title={delegated ? 'Asked the agent that delegated it' : 'Asked you'}
      meta={resolveAskMeta(call, delegated)}
    >
      <span className='selectable text-fg-4 text-xs'>
        <InlineMarkdown text={call.description.target ?? ''} />
      </span>
      {context && <Markdown text={context} className='text-fg-3' />}
      {choices.length > 0 && (
        <ul className='flex flex-wrap gap-1.5 text-xs'>
          {choices.map((choice) => (
            <li key={choice} className={cn(CHIP, 'px-1.5')}>
              {choice}
            </li>
          ))}
        </ul>
      )}
      {answer !== null && (
        <div className='flex gap-2 border-border border-t pt-2.5 text-xs'>
          <span className='shrink-0 text-fg-2'>{delegated ? 'Its answer' : 'Your answer'}</span>
          <span className='selectable min-w-0 whitespace-pre-wrap text-fg-4'>{answer}</span>
        </div>
      )}
    </Card>
  );
}

function SuggestionsCard({ args }: { args: ChatToolArgs }) {
  const tasks = readList(args, 'tasks');
  return (
    <Card
      icon='IconLightbulbGlow'
      title={`Suggested ${formatCount(tasks.length, 'task', 'tasks')}`}
      meta='In Overview'
    >
      <ul className='flex flex-col gap-2'>
        {tasks.map((task, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: suggestions are positional
          <li key={index} className='flex flex-col gap-px text-xs'>
            <InlineMarkdown text={readString(task, 'title') ?? ''} className='font-medium text-fg-4' />
            <InlineMarkdown text={readString(task, 'why') ?? ''} className='text-fg-3' />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RememberCard({ args }: { args: ChatToolArgs }) {
  const why = readString(args, 'why');
  return (
    <Card icon='IconLightbulbGlow' title='Proposed a rule to remember' meta='In Settings → Memory'>
      <div className='flex flex-col gap-px text-xs'>
        <InlineMarkdown text={readString(args, 'text') ?? ''} className='selectable font-medium text-fg-4' />
        {why && <InlineMarkdown text={why} className='text-fg-3' />}
      </div>
    </Card>
  );
}

function SuggestedWatchCard({ args, task }: { args: ChatToolArgs; task: Task | null }) {
  const taskId = task?.id ?? null;
  const select = React.useCallback(
    (state: ShinsaState) => selectCallSuggestion(state, taskId, args),
    [taskId, args]
  );
  const suggestion = useShinsaSelector(select);
  const open = suggestion?.status === 'open';
  return (
    <Card icon='IconRadar' title='Suggested a watch' meta={describeSuggestionStatus(suggestion)}>
      <div className='flex flex-col gap-px text-xs'>
        <InlineMarkdown
          text={readString(args, 'message') ?? ''}
          className='selectable font-medium text-fg-4'
        />
        <span className='text-fg-3'>
          {suggestion ? describeSuggestionDetail(suggestion) : (readString(args, 'source') ?? '')}
        </span>
      </div>
      {open && suggestion && <SuggestedWatchButtons suggestion={suggestion} primary />}
      {suggestion?.status === 'accepted' && suggestion.scheduleId && (
        <InAppLink className='text-xs' path={resolveAutomationPath(suggestion.scheduleId)}>
          Open the watch
        </InAppLink>
      )}
    </Card>
  );
}

function DeliveryCard({ title, args, field }: { title: string; args: ChatToolArgs; field: string }) {
  const proposal = readProposedChange(args);
  return (
    <Card icon='IconSend' title={title}>
      <Markdown text={readString(args, field) ?? ''} />
      {proposal && (
        <div className='flex flex-col gap-px border-border border-t pt-2.5 text-xs'>
          <span className='text-2xs text-fg-2'>Proposed a change</span>
          <InlineMarkdown text={proposal.why} className='selectable text-fg-4' />
        </div>
      )}
    </Card>
  );
}

function ReshapeCard({ args }: { args: ChatToolArgs }) {
  const steps = readStrings(args, 'steps');
  return (
    <Card icon='IconSplit' title={steps.length > 0 ? 'Set the steps' : 'Changed the kind of task'}>
      <Markdown text={readString(args, 'reason') ?? ''} />
      {steps.length > 0 && (
        <div className='flex flex-col gap-px border-border border-t pt-2.5 text-xs'>
          <span className='text-2xs text-fg-2'>Steps</span>
          <span className='text-fg-4'>{capitalise(describeSteps(steps))}</span>
        </div>
      )}
    </Card>
  );
}

function InsetToolRow({ call, live }: { call: ToolCall; live: boolean }) {
  return (
    <div className={CHAT_INSET}>
      <ToolRow call={call} live={live} />
    </div>
  );
}

export function HandoverCard({
  call,
  run,
  live,
  task = null,
}: {
  call: ToolCall;
  run: Run;
  live: boolean;
  task?: Task | null;
}) {
  const { tool } = call;
  if (tool.kind !== 'shinsa') return <InsetToolRow call={call} live={live} />;
  if (call.failed && tool.name !== 'ask') {
    return (
      <div className={cn('flex min-w-0 flex-col gap-1', CHAT_INSET)}>
        <ToolRow call={call} live={live} />
        <p className={cn('selectable line-clamp-3 whitespace-pre-wrap text-red-text text-xs', ROW_INDENT)}>
          {call.result}
        </p>
      </div>
    );
  }
  switch (tool.name) {
    case 'propose_plan':
      return <PlanCard args={tool.args} task={task} />;
    case 'complete_phase':
      return (
        <SummaryCard
          icon='IconSend'
          title={
            typeof run.phaseIndex === 'number'
              ? `Handed over phase ${run.phaseIndex + 1}`
              : 'Handed over the phase'
          }
          args={tool.args}
          meta={resolveSpotsMeta(tool.args)}
          task={task}
        />
      );
    case 'complete_fix':
      return <SummaryCard icon='IconSend' title='Handed over the fix' args={tool.args} task={task} />;
    case 'report_review':
      return <ReviewCard args={tool.args} task={task} />;
    case 'ask':
      return <AskCard call={call} args={tool.args} delegated={Boolean(run.delegation)} />;
    case 'suggest_tasks':
      return <SuggestionsCard args={tool.args} />;
    case 'remember':
      return <RememberCard args={tool.args} />;
    case 'answer':
      return <DeliveryCard title='Handed over the answer' args={tool.args} field='answer' />;
    case 'report_diagnosis':
      return <DeliveryCard title='Reported the diagnosis' args={tool.args} field='diagnosis' />;
    case 'submit_report':
      return <DeliveryCard title='Wrote the report' args={tool.args} field='report' />;
    case 'report_outcome':
      return <DeliveryCard title='Reported the outcome' args={tool.args} field='outcome' />;
    case 'report_watch':
      return <DeliveryCard title='Reported the watchdog check' args={tool.args} field='summary' />;
    case 'reshape_task':
      return <ReshapeCard args={tool.args} />;
    case 'set_schedule':
      return <SuggestedWatchCard args={tool.args} task={task} />;
    case 'attach_evidence':
    case 'remove_evidence':
    case 'find_tasks':
    case 'read_task':
    case 'list_repository_work':
    case 'list_services':
    case 'run_service':
    case 'add_service':
    case 'note':
    case 'wait_for':
      return <InsetToolRow call={call} live={live} />;
  }
}
