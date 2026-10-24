import {
  isTaskSettled,
  listDependents,
  listPendingDependencies,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@shinsa/ui/components/dropdown-menu';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import type * as React from 'react';
import { AccountChoiceItems } from '@/components/accounts/account-items.tsx';
import { useCopyText } from '@/components/controls/copy-button.tsx';
import { BranchDetails } from '@/components/links/branch.tsx';
import { CheckList, PullRequestDetails } from '@/components/links/pull-request.tsx';
import { RepoDetails } from '@/components/links/repo.tsx';
import { TaskPopoverRows } from '@/components/links/task.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { InfoHeader, InfoPopover, InfoRow, InfoSection } from '@/components/overlays/info-popover.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { Pulse } from '@/components/status/pulse.tsx';
import { PriorityChoices } from '@/components/task/action-items.tsx';
import { WaitsOnItems } from '@/components/task/dependency-items.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { describeRunsOn } from '@/lib/accounts/account.ts';
import { formatCount } from '@/lib/format/count.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { TONE_FILL, TONE_TEXT } from '@/lib/format/tone.ts';
import { describeChecksPassed, hasFailingCheck, isAgentWorking } from '@/lib/overview/now.ts';
import { resolveCostFacts } from '@/lib/tasks/cost.ts';
import { describePullRequestFact, describeStarted } from '@/lib/tasks/facts.ts';
import { type Check, listTaskChecks, resolvePullRequestTone } from '@/lib/tasks/pull-request.ts';
import { resolveRoundTag } from '@/lib/tasks/rounds.ts';
import { describeTaskSteps, resolveShapeIcon, resolveShapeLabel } from '@/lib/tasks/shapes.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { resolveTriageWhy } from '@/lib/tasks/triage.ts';
import { navigate, resolveTaskPath } from '@/router.ts';

const FACT =
  'inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-control-sm px-1.5 text-fg-2 text-xs';

const FACT_INTERACTIVE =
  'corner-superellipse/1.125 cursor-pointer outline-none transition-colors duration-150 hover:bg-bg-a2 hover:text-fg-4 active:bg-bg-a2 active:text-fg-4 data-popup-open:bg-bg-a2 data-popup-open:text-fg-4';

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
  const round = resolveRoundTag(task);
  if (!task.handle) return null;
  return (
    <span className='flex items-center'>
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
      {round && <span className={cn(FACT, 'tabular-nums')}>{round}</span>}
    </span>
  );
}

function StatusFact({ state, task }: { state: ShinsaState; task: Task }) {
  const status = resolveTaskStatus(state, task);
  const working = isAgentWorking(state, task);
  return (
    <span className={FACT}>
      <span className='grid size-3.5 shrink-0 place-items-center'>
        {working ? (
          <Pulse tone={status.tone} />
        ) : (
          <span className={cn('size-1.5 rounded-full', TONE_FILL[status.tone])} />
        )}
      </span>
      <span className='font-medium'>{status.label}</span>
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
          <Icon name='IconFolder1' className='size-3.5 shrink-0' />
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
          <Icon name='IconBranch' className='size-3.5 shrink-0' />
          <span className='truncate'>{task.branch}</span>
        </>
      }
    >
      <BranchDetails state={state} task={task} />
    </FactPopover>
  );
}

function PullRequestFact({ state, task, checks }: { state: ShinsaState; task: Task; checks: Check[] }) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  return (
    <FactPopover
      trigger={
        <>
          <Icon
            name='IconPullRequest'
            className={cn('size-3.5 shrink-0', TONE_TEXT[resolvePullRequestTone(pullRequest)])}
          />
          <span className='tabular-nums'>#{pullRequest.number}</span>
          {describePullRequestFact(pullRequest).map((note) => (
            <span key={note.text} className={TONE_TEXT[note.tone]}>
              {note.text}
            </span>
          ))}
        </>
      }
    >
      <PullRequestDetails state={state} task={task} checks={checks} />
    </FactPopover>
  );
}

function ChecksFact({ checks }: { checks: Check[] }) {
  const failing = hasFailingCheck(checks);
  return (
    <FactPopover
      trigger={
        <>
          <Icon
            name={failing ? 'IconCircleXFilled' : 'IconCheckCircle2Filled'}
            className={cn('size-3.5 shrink-0', failing ? 'text-red-4' : 'text-primary-4')}
          />
          <span className='tabular-nums'>{describeChecksPassed(checks)}</span>
        </>
      }
    >
      <CheckList checks={checks} />
    </FactPopover>
  );
}

function CostFact({ state, task }: { state: ShinsaState; task: Task }) {
  const cost = resolveCostFacts(state, task);
  if (!cost) return null;
  return (
    <FactPopover
      trigger={
        <>
          <Icon
            name='IconCoins'
            className={cn('size-3.5 shrink-0', cost.budget?.over && 'text-orange-text')}
          />
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
      <PriorityIcon priority={task.priority} className='size-3.5 shrink-0' />
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

function ShapeFact({ state, task }: { state: ShinsaState; task: Task }) {
  return (
    <Hint label={describeTaskSteps(task)} detail={resolveTriageWhy(state, task, 'shape')}>
      <span className={cn(FACT, 'max-w-72 cursor-default')}>
        <Icon name={resolveShapeIcon(task)} className='size-3.5 shrink-0' />
        <span className='truncate'>{resolveShapeLabel(task)}</span>
      </span>
    </Hint>
  );
}

function StartedFact({ state, task }: { state: ShinsaState; task: Task }) {
  const waiting = listPendingDependencies(state, task).length > 0;
  const why = waiting ? null : resolveTriageWhy(state, task, 'start');
  return (
    <span className={FACT}>
      <Icon name='IconClock' className='size-3.5 shrink-0' />
      <TimeAgo at={task.createdAt} text={(now) => describeStarted(task, now)} detail={why ?? undefined} />
    </span>
  );
}

function AccountFact({ task }: { task: Task }) {
  if (!task.account) return null;
  if (isTaskSettled(task)) {
    return (
      <span className={cn(FACT, 'max-w-72')}>
        <Icon name='IconUser' className='size-3.5 shrink-0' />
        <span className='truncate'>{describeRunsOn(task.account)}</span>
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type='button' className={cn(FACT, FACT_INTERACTIVE, 'max-w-72')} />}
      >
        <Icon name='IconUser' className='size-3.5 shrink-0' />
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
        <Icon name={icon} className='size-3.5 shrink-0' />
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
          <Icon name={icon} className='size-3.5 shrink-0' />
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
      <Icon name='IconHourglass' className={cn('size-3.5 shrink-0', cancelled && 'text-orange-text')} />
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

export function TaskFacts({
  state,
  task,
  className,
}: {
  state: ShinsaState;
  task: Task;
  className?: string;
}) {
  const base = task.baseTaskId ? state.tasks[task.baseTaskId] : undefined;
  const checks = listTaskChecks(task);
  return (
    <div className={cn('-ms-1.5 flex flex-wrap items-center gap-1', className)}>
      <HandleFact task={task} />
      <StatusFact state={state} task={task} />
      <ShapeFact state={state} task={task} />
      <RepoFact state={state} task={task} />
      <BranchFact state={state} task={task} />
      <PullRequestFact state={state} task={task} checks={checks} />
      {!task.pullRequest && checks.length > 0 && <ChecksFact checks={checks} />}
      <PriorityFact state={state} task={task} />
      <StartedFact state={state} task={task} />
      <CostFact state={state} task={task} />
      <AccountFact task={task} />
      {base && <RelatedFact state={state} icon='IconLayersTwo' verb='On top of' tasks={[base]} />}
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
