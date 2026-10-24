import { type ChatToolArgs, capitalise, type Run } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { ROW_INDENT, ToolRow } from '@/components/chat/tool-group.tsx';
import { CARD, CARD_HEADER, CHIP } from '@/components/layout/surface/card.ts';
import { StepNumber } from '@/components/layout/surface/step-number.tsx';
import { PlanParameterList } from '@/components/overview/plan-parameters.tsx';
import { FindingText } from '@/components/text/finding-text.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import {
  isWithdrawn,
  readPlanParameters,
  readProposedChange,
  resolveAskMeta,
  resolveSpotsMeta,
} from '@/lib/chat/handover.ts';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { readList, readString, readStrings } from '@/lib/chat/tool-describe.ts';
import { formatCount } from '@/lib/format/count.ts';
import { describeReportedFindings, readReportedFindings } from '@/lib/review/findings.ts';
import { describeSteps } from '@/lib/tasks/shapes.ts';

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
      <h3 className={CARD_HEADER}>
        <Icon name={icon} className='size-3.5' />
        {title}
        {meta && <span className='ms-auto font-normal text-2xs text-fg-2'>{meta}</span>}
      </h3>
      {children && <div className='flex min-w-0 flex-col gap-3 border-border border-t p-3'>{children}</div>}
    </section>
  );
}

function PlanCard({ args }: { args: ChatToolArgs }) {
  const goal = readString(args, 'goal');
  const steps = readList(args, 'plan');
  const changed = readString(args, 'change_summary');
  return (
    <Card
      icon='IconMap'
      title={changed ? 'Revised the plan' : 'Proposed the plan'}
      meta={steps.length > 0 ? formatCount(steps.length, 'phase', 'phases') : null}
    >
      {changed && (
        <div className='flex flex-col gap-px text-xs'>
          <span className='text-2xs text-fg-2'>What changed</span>
          <InlineMarkdown text={changed} className='text-fg-4' />
        </div>
      )}
      {goal && <Markdown text={goal} />}
      {steps.length > 0 && (
        <ol className='flex flex-col gap-2'>
          {steps.map((step, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: plan steps are positional
            <li key={index} className='flex gap-2.5'>
              <StepNumber index={index} />
              <div className='flex min-w-0 flex-col gap-px pt-px'>
                <span className='font-medium text-fg-4 text-xs'>
                  <InlineMarkdown text={readString(step, 'title') ?? `Phase ${index + 1}`} />
                </span>
                {readString(step, 'detail') && (
                  <span className='text-fg-3 text-xs'>
                    <InlineMarkdown text={readString(step, 'detail') ?? ''} />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <PlanParameterList document={readPlanParameters(args)} headingClassName='text-2xs text-fg-2' />
    </Card>
  );
}

function SummaryCard({
  icon,
  title,
  args,
  meta,
}: {
  icon: IconName;
  title: string;
  args: ChatToolArgs;
  meta?: React.ReactNode;
}) {
  const summary = readString(args, 'summary');
  const decisions = readList(args, 'decisions');
  return (
    <Card icon={icon} title={title} meta={meta}>
      {summary && <Markdown text={summary} />}
      {decisions.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <span className='text-2xs text-fg-2'>Decisions</span>
          <ul className='flex flex-col gap-1.5'>
            {decisions.map((decision, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: decisions are positional
              <li key={index} className='flex gap-2 text-xs'>
                <Icon name='IconLightbulbGlow' className='mt-0.5 size-3.5 shrink-0 text-fg-4' />
                <span className='min-w-0'>
                  <span className='text-fg-4'>
                    <InlineMarkdown text={readString(decision, 'decision') ?? ''} />
                  </span>{' '}
                  {readString(decision, 'reason') && (
                    <span className='text-fg-3'>
                      <InlineMarkdown text={readString(decision, 'reason') ?? ''} />
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ReviewCard({ args }: { args: ChatToolArgs }) {
  const findings = readReportedFindings(args);
  const { title, meta } = describeReportedFindings(findings);
  if (findings.length === 0) return <Card icon='IconShieldCheck' title={title} />;
  return (
    <Card icon='IconShieldCheck' title={title} meta={meta}>
      <ul className='flex flex-col gap-2.5'>
        {findings.map((finding, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: findings are positional
          <li key={index} className='flex'>
            <FindingText severity={finding.severity} place={finding} message={finding.message} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AskCard({ call, args, delegated }: { call: ToolCall; args: ChatToolArgs; delegated: boolean }) {
  const context = readString(args, 'context');
  const choices = readStrings(args, 'choices');
  const declined = call.failed || isWithdrawn(call);
  return (
    <Card
      icon='IconBubbleQuestion'
      title={delegated ? 'Asked the agent that delegated it' : 'Asked you'}
      meta={resolveAskMeta(call, delegated)}
    >
      <span className='text-fg-4 text-xs'>
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
      {call.result !== null && !declined && (
        <div className='flex gap-2 border-border border-t pt-2.5 text-xs'>
          <span className='shrink-0 text-fg-2'>{delegated ? 'Its answer' : 'Your answer'}</span>
          <span className='min-w-0 whitespace-pre-wrap text-fg-4'>{call.result}</span>
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
      title={`Suggested ${formatCount(tasks.length, 'follow-up', 'follow-ups')}`}
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

function DeliveryCard({ title, args, field }: { title: string; args: ChatToolArgs; field: string }) {
  const proposal = readProposedChange(args);
  return (
    <Card icon='IconSend' title={title}>
      <Markdown text={readString(args, field) ?? ''} />
      {proposal && (
        <div className='flex flex-col gap-px border-border border-t pt-2.5 text-xs'>
          <span className='text-2xs text-fg-2'>Proposed a change</span>
          <InlineMarkdown text={proposal.why} className='text-fg-4' />
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

export function HandoverCard({ call, run, live }: { call: ToolCall; run: Run; live: boolean }) {
  const { tool } = call;
  if (tool.kind !== 'shinsa') return <ToolRow call={call} live={live} />;
  if (call.failed && tool.name !== 'ask') {
    return (
      <div className='flex min-w-0 flex-col gap-1'>
        <ToolRow call={call} live={live} />
        <p className={cn('line-clamp-3 whitespace-pre-wrap text-2xs text-red-text', ROW_INDENT)}>
          {call.result}
        </p>
      </div>
    );
  }
  switch (tool.name) {
    case 'propose_plan':
      return <PlanCard args={tool.args} />;
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
        />
      );
    case 'complete_fix':
      return <SummaryCard icon='IconSend' title='Handed over the fix' args={tool.args} />;
    case 'report_review':
      return <ReviewCard args={tool.args} />;
    case 'ask':
      return <AskCard call={call} args={tool.args} delegated={Boolean(run.delegation)} />;
    case 'suggest_tasks':
      return <SuggestionsCard args={tool.args} />;
    case 'answer':
      return <DeliveryCard title='Handed over the answer' args={tool.args} field='answer' />;
    case 'report_diagnosis':
      return <DeliveryCard title='Reported the findings' args={tool.args} field='findings' />;
    case 'submit_report':
      return <DeliveryCard title='Wrote the report' args={tool.args} field='report' />;
    case 'report_outcome':
      return <DeliveryCard title='Reported the outcome' args={tool.args} field='outcome' />;
    case 'reshape_task':
      return <ReshapeCard args={tool.args} />;
    case 'attach_evidence':
    case 'find_tasks':
    case 'read_task':
    case 'note':
    case 'wait_for':
      return <ToolRow call={call} live={live} />;
  }
}
