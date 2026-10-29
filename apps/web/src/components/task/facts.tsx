import {
  isTaskSettled,
  listDependents,
  listPendingDependencies,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Tooltip, TooltipContent, TooltipLabel, TooltipTrigger } from '@shinsa/ui/components/tooltip';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { AccountChoiceItems } from '@/components/accounts/account-items.tsx';
import { CheckStateIcon, ChecksSections } from '@/components/checks/checks-list.tsx';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { BranchDetails } from '@/components/links/branch.tsx';
import { InAppLink } from '@/components/links/link.tsx';
import { PullRequestDetails } from '@/components/links/pull-request.tsx';
import { RepoDetails, RepoIcon } from '@/components/links/repo.tsx';
import { TaskPopoverRows } from '@/components/links/task.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  InfoHeader,
  InfoLine,
  InfoPopover,
  InfoRow,
  InfoSection,
} from '@/components/overlays/info-popover.tsx';
import { TaskServicesFact } from '@/components/services/task-menu.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { PriorityChoices } from '@/components/task/action-items.tsx';
import { WaitsOnItems } from '@/components/task/dependency-items.tsx';
import { FACT, FACT_INTERACTIVE } from '@/components/task/fact.ts';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { describeRunsOn } from '@/lib/accounts/account.ts';
import { describeAgentCount, listTaskAgents } from '@/lib/chat/agents.ts';
import { describeCoverageFact, describeCoverageSummary } from '@/lib/coverage.ts';
import { formatCount } from '@/lib/format/count.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { isAgentWorking } from '@/lib/overview/now.ts';
import { type ChecksView, resolveChecksView, resolveStatusState } from '@/lib/tasks/checks.ts';
import { resolveCostFacts } from '@/lib/tasks/cost.ts';
import { describePullRequestFact, describeStarted } from '@/lib/tasks/facts.ts';
import { resolvePullRequestTone } from '@/lib/tasks/pull-request.ts';
import { ROUND_ICON, resolveRoundFact } from '@/lib/tasks/rounds.ts';
import { resolveTaskStatus, resolveTaskStatusIcon } from '@/lib/tasks/status.ts';
import { resolveTriageWhy } from '@/lib/tasks/triage.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

function FactPopover({
  trigger,
  className,
  children,
}: {
  trigger: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <InfoPopover
      render={<button type='button' className={cn(FACT, FACT_INTERACTIVE, className)} />}
      trigger={trigger}
    >
      {children}
    </InfoPopover>
  );
}

function HandleFact({ task }: { task: Task }) {
  const { copied, copy } = useCopyText(task.handle ?? '');
  if (!task.handle) return null;
  return (
    <Hint label={copied ? 'Copied' : 'Copy the task’s handle'}>
      <button
        type='button'
        aria-label={`Copy ${task.handle}`}
        onClick={copy}
        className={cn(FACT, FACT_INTERACTIVE, 'tabular-nums')}
      >
        {task.handle}
      </button>
    </Hint>
  );
}

function RoundFact({ task }: { task: Task }) {
  const round = resolveRoundFact(task);
  if (!round) return null;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn(FACT, 'max-w-72 cursor-default tabular-nums')} />}>
        <Icon size='sm' name={ROUND_ICON} />
        {round.label}
      </TooltipTrigger>
      <TooltipContent className='flex-col items-stretch gap-1'>
        <span>{round.title}</span>
        <InfoLine
          label={
            <span className='flex items-center gap-1.5'>
              <Icon size='sm' name={ROUND_ICON} className={TONE_TEXT[round.status.tone]} />
              <span className={TONE_TEXT[round.status.tone]}>{round.status.label}</span>
            </span>
          }
          value={<TooltipLabel>{round.time}</TooltipLabel>}
        />
      </TooltipContent>
    </Tooltip>
  );
}

const AGENT_INDENT = ['ps-2', 'ps-6', 'ps-10', 'ps-14'];

function AgentsFact({ state, task }: { state: ShinsaState; task: Task }) {
  const agents = listTaskAgents(state, task);
  if (agents.length === 0) return null;
  return (
    <FactPopover
      trigger={
        <>
          <Icon size='sm' name='IconAgents' />
          <span className='tabular-nums'>{describeAgentCount(agents)}</span>
        </>
      }
    >
      <InfoHeader title='Who worked on this' description='Each agent role, and the agents it delegated to.' />
      <HoverHighlight className='border-border border-t p-1' indicatorClassName='rounded-item'>
        <ul aria-label='Who worked on this' className='flex flex-col'>
          {agents.map((agent) => (
            <li key={agent.key}>
              <button
                type='button'
                data-highlight-item=''
                onClick={() => navigate(resolveTaskPath(task, { tab: 'chat', run: agent.runId }))}
                className={cn(
                  'corner-superellipse/1.125 flex h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-item pe-2 text-start text-xs',
                  AGENT_INDENT[agent.depth] ?? AGENT_INDENT.at(-1)
                )}
              >
                {agent.depth > 0 && (
                  <Icon size='sm' name='IconArrowCornerDownRight' aria-hidden className='text-fg-2' />
                )}
                <Icon size='sm' name={agent.icon} className='text-fg-3' />
                <span className='shrink-0 font-medium text-fg-4'>{agent.name}</span>
                {agent.label && <Truncate className='min-w-0 text-fg-3'>{agent.label}</Truncate>}
                <span className='ms-auto flex shrink-0 items-center gap-1.5 ps-3 text-2xs text-fg-2'>
                  {agent.live && <Pulse tone='blue' />}
                  {agent.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </HoverHighlight>
    </FactPopover>
  );
}

function StatusFact({ state, task }: { state: ShinsaState; task: Task }) {
  const status = resolveTaskStatus(state, task);
  const working = isAgentWorking(state, task);
  return (
    <span className={FACT}>
      <Icon size='sm' name={resolveTaskStatusIcon(state, task)} className={TONE_TEXT[status.tone]} />
      <span className='font-medium'>{status.label}</span>
      {working && <Pulse tone={status.tone} />}
    </span>
  );
}

function RepoFact({ state, task }: { state: ShinsaState; task: Task }) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  if (!repo) return null;
  return (
    <FactPopover
      trigger={
        <>
          <RepoIcon state={state} repo={repo} icon='IconFolder1' />
          <span className='truncate'>{repo.name}</span>
        </>
      }
    >
      <RepoDetails state={state} repo={repo} />
    </FactPopover>
  );
}

function BranchFact({ state, task }: { state: ShinsaState; task: Task }) {
  if (!task.branch) return null;
  return (
    <FactPopover
      className='max-w-64'
      trigger={
        <>
          <Icon size='sm' name='IconBranch' />
          <span className='truncate'>{task.branch}</span>
        </>
      }
    >
      <BranchDetails state={state} task={task} />
    </FactPopover>
  );
}

function PullRequestFact({ state, task }: { state: ShinsaState; task: Task }) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  return (
    <FactPopover
      trigger={
        <>
          <Icon size='sm' name='IconPullRequest' className={TONE_TEXT[resolvePullRequestTone(pullRequest)]} />
          <span className='tabular-nums'>#{pullRequest.number}</span>
          {describePullRequestFact(pullRequest).map((note) => (
            <span key={note.text} className={TONE_TEXT[note.tone]}>
              {note.text}
            </span>
          ))}
        </>
      }
    >
      <PullRequestDetails state={state} task={task} />
    </FactPopover>
  );
}

function ChecksFact({ view }: { view: ChecksView }) {
  return (
    <FactPopover
      trigger={
        <>
          <CheckStateIcon state={resolveStatusState(view.status)} />
          <span className='tabular-nums'>{view.summary}</span>
        </>
      }
    >
      <ChecksSections view={view} />
    </FactPopover>
  );
}

function CoverageFact({ task }: { task: Task }) {
  const fact = describeCoverageFact(task.coverage);
  if (!fact) return null;
  return (
    <Hint label={`${describeCoverageSummary(task.coverage)}. How to test in Review lists the files.`}>
      <InAppLink
        path={resolveTaskPath(task, { tab: 'review', spot: 'testing' })}
        className={cn(FACT, FACT_INTERACTIVE, 'no-underline')}
      >
        <Icon size='sm' name='IconShieldCheck' />
        <span className='tabular-nums'>{fact}</span>
      </InAppLink>
    </Hint>
  );
}

function CostFact({ state, task }: { state: ShinsaState; task: Task }) {
  const cost = resolveCostFacts(state, task);
  if (!cost) return null;
  return (
    <FactPopover
      trigger={
        <>
          <Icon size='sm' name={cost.icon} className={cn(cost.budget?.over && 'text-orange-text')} />
          <span className='tabular-nums'>{cost.total}</span>
        </>
      }
    >
      <InfoHeader title={cost.heading} description={cost.detail} />
      <InfoSection title='By step'>
        {cost.byRole.map((row) => (
          <InfoRow key={row.key} label={row.label} value={row.cost} />
        ))}
      </InfoSection>
      {cost.byPhase.length > 0 && (
        <InfoSection title='By phase'>
          {cost.byPhase.map((row) => (
            <InfoRow key={row.key} label={row.label} value={row.cost} />
          ))}
        </InfoSection>
      )}
    </FactPopover>
  );
}

function PriorityFact({ state, task }: { state: ShinsaState; task: Task }) {
  const why = resolveTriageWhy(state, task, 'priority');
  const trigger = (
    <DropdownMenuTrigger render={<button type='button' className={cn(FACT, FACT_INTERACTIVE)} />}>
      <PriorityIcon priority={task.priority} />
      {PRIORITY_LABEL[task.priority]}
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {why ? <Hint label={why}>{trigger}</Hint> : trigger}
      <DropdownMenuContent align='start' className='min-w-40'>
        <PriorityChoices task={task} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StartedFact({ state, task }: { state: ShinsaState; task: Task }) {
  const waiting = listPendingDependencies(state, task).length > 0;
  const why = waiting ? null : resolveTriageWhy(state, task, 'start');
  return (
    <span className={FACT}>
      <Icon size='sm' name='IconClock' />
      <TimeAgo at={task.createdAt} text={(now) => describeStarted(task, now)} detail={why ?? undefined} />
    </span>
  );
}

function AccountFact({ task }: { task: Task }) {
  if (!task.account) return null;
  if (isTaskSettled(task)) {
    return (
      <span className={cn(FACT, 'max-w-72')}>
        <Icon size='sm' name='IconUser' />
        <span className='truncate'>{describeRunsOn(task.account)}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type='button' className={cn(FACT, FACT_INTERACTIVE, 'max-w-72')} />}
      >
        <Icon size='sm' name='IconUser' />
        <span className='truncate'>{describeRunsOn(task.account)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='min-w-48 max-w-80'>
        <AccountChoiceItems task={task} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RelatedFact({
  state,
  icon,
  verb,
  tasks,
}: {
  state: ShinsaState;
  icon: IconName;
  verb: string;
  tasks: Task[];
}) {
  const [first] = tasks;
  if (!first) return null;
  if (tasks.length === 1) {
    return (
      <button
        type='button'
        onClick={() => navigate(resolveTaskPath(first))}
        className={cn(FACT, FACT_INTERACTIVE, 'max-w-72')}
      >
        <Icon size='sm' name={icon} />
        <span className='shrink-0'>{verb}</span>
        <Truncate>{first.title}</Truncate>
      </button>
    );
  }
  const count = formatCount(tasks.length, 'task', 'tasks');
  return (
    <FactPopover
      trigger={
        <>
          <Icon size='sm' name={icon} />
          <span>{verb}</span>
          <span className='tabular-nums'>{count}</span>
        </>
      }
    >
      <InfoHeader title={`${verb} ${count}`} />
      <div className='border-border border-t p-1'>
        <TaskPopoverRows state={state} tasks={tasks} />
      </div>
    </FactPopover>
  );
}

function WaitsOnFact({ state, task }: { state: ShinsaState; task: Task }) {
  const waitsOn = listPendingDependencies(state, task);
  if (waitsOn.length === 0) return null;
  const cancelled = waitsOn.some((blocker) => blocker.stage === 'cancelled');
  const why = resolveTriageWhy(state, task, 'start');
  const trigger = (
    <DropdownMenuTrigger render={<button type='button' className={cn(FACT, FACT_INTERACTIVE, 'max-w-72')} />}>
      <Icon size='sm' name='IconHourglass' className={cn(cancelled && 'text-orange-text')} />
      <span className='shrink-0'>Waits on</span>
      <span className='truncate'>{waitsOn.map((blocker) => blocker.title).join(', ')}</span>
    </DropdownMenuTrigger>
  );
  return (
    <DropdownMenu>
      {why ? <Hint label={why}>{trigger}</Hint> : trigger}
      <DropdownMenuContent align='start' className='min-w-56 max-w-80'>
        <WaitsOnItems state={state} task={task} waitsOn={waitsOn} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskSharedFacts({
  state,
  task,
  className,
}: {
  state: ShinsaState;
  task: Task;
  className?: string;
}) {
  const checks = resolveChecksView(state, task);
  return (
    <div className={cn('-ms-1.5 flex flex-wrap items-center gap-1', className)}>
      <HandleFact task={task} />
      <RepoFact state={state} task={task} />
      <BranchFact state={state} task={task} />
      <PullRequestFact state={state} task={task} />
      {checks && <ChecksFact view={checks} />}
      <CoverageFact task={task} />
    </div>
  );
}

export function TaskFacts({
  state,
  task,
  className,
}: {
  state: ShinsaState;
  task: Task;
  className?: string;
}) {
  const checks = resolveChecksView(state, task);
  return (
    <div className={cn('-ms-1.5 flex flex-wrap items-center gap-1', className)}>
      <HandleFact task={task} />
      <RoundFact task={task} />
      <StatusFact state={state} task={task} />
      <RepoFact state={state} task={task} />
      <BranchFact state={state} task={task} />
      <PullRequestFact state={state} task={task} />
      {!task.pullRequest && checks && <ChecksFact view={checks} />}
      <CoverageFact task={task} />
      <TaskServicesFact state={state} task={task} />
      <PriorityFact state={state} task={task} />
      <StartedFact state={state} task={task} />
      <CostFact state={state} task={task} />
      <AccountFact task={task} />
      <AgentsFact state={state} task={task} />
      <WaitsOnFact state={state} task={task} />
      <RelatedFact
        state={state}
        icon='IconArrowSplitRight'
        verb='Unblocks'
        tasks={listDependents(state, task.id)}
      />
    </div>
  );
}
