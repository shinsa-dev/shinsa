import type { ShinsaState, Task } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { GlyphLabel, INLINE_TILE, SMART_LINK } from '@/components/links/link.tsx';
import { TaskPopoverRows } from '@/components/links/task.tsx';
import {
  InfoAction,
  InfoHeader,
  InfoPopover,
  InfoRow,
  InfoSection,
} from '@/components/overlays/info-popover.tsx';
import { CHECK_TEXT, CheckOutcomeIcon } from '@/components/status/check-mark.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import {
  type Check,
  CI_GLYPH,
  countPassing,
  describeMergeable,
  describePullRequestState,
  listTaskChecks,
  resolvePullRequestTone,
} from '@/lib/tasks/pull-request.ts';

export function CheckList({ checks }: { checks: Check[] }) {
  const passing = countPassing(checks);
  return (
    <InfoSection
      title={
        <>
          Checks
          <span
            className={cn(
              'font-normal tabular-nums',
              passing === checks.length ? CHECK_TEXT : 'text-red-text'
            )}
          >
            {passing}/{checks.length}
          </span>
        </>
      }
    >
      <ul className='flex flex-col gap-1.5 px-3 pb-1.5'>
        {checks.map((check) => (
          <li key={check.name} className='flex min-w-0 items-start gap-2'>
            <CheckOutcomeIcon outcome={check.outcome} />
            <span className='flex min-w-0 flex-1 flex-col gap-px'>
              <Truncate className='text-fg-4 text-xs leading-4'>{check.name}</Truncate>
              {check.detail && <span className='text-2xs text-fg-2'>{check.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </InfoSection>
  );
}

export function PullRequestDetails({
  state,
  task,
  checks,
  showTask = false,
}: {
  state: ShinsaState;
  task: Task;
  checks: Check[];
  showTask?: boolean;
}) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  const ci = CI_GLYPH[pullRequest.checks];
  const mergeable = describeMergeable(pullRequest);
  const comments = pullRequest.unresolvedComments;
  return (
    <>
      <InfoHeader
        title={`Pull request #${pullRequest.number}`}
        description={describePullRequestState(pullRequest)}
      />
      {showTask && (
        <div className='border-border border-t p-1'>
          <TaskPopoverRows state={state} tasks={[task]} />
        </div>
      )}
      <InfoSection>
        <InfoRow icon={ci.icon} iconClassName={ci.className} label='CI checks' value={ci.label} />
        <InfoRow
          icon='IconBubbleText'
          label='Unresolved comments'
          value={comments === 0 ? 'None' : comments}
          valueClassName={comments > 0 ? 'text-amber-text tabular-nums' : undefined}
        />
        {pullRequest.state === 'open' && (
          <InfoRow
            icon='IconMerged'
            label='Mergeable'
            value={mergeable.label}
            valueClassName={TONE_TEXT[mergeable.tone]}
          />
        )}
      </InfoSection>
      {checks.length > 0 && <CheckList checks={checks} />}
      <InfoAction label='Open on GitHub' href={pullRequest.url} />
    </>
  );
}

export function PrLink({ state, task }: { state: ShinsaState; task: Task }) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  return (
    <InfoPopover
      className='w-72'
      render={<a data-smart href={pullRequest.url} target='_blank' rel='noreferrer' className={SMART_LINK} />}
      trigger={
        <GlyphLabel
          glyph={
            <StatusTile
              icon={pullRequest.state === 'merged' ? 'IconMerged' : 'IconPullRequest'}
              tone={resolvePullRequestTone(pullRequest)}
              size='sm'
              className={INLINE_TILE}
            />
          }
          text={`#${pullRequest.number}`}
          className='tabular-nums'
        />
      }
    >
      <PullRequestDetails state={state} task={task} checks={listTaskChecks(task)} showTask />
    </InfoPopover>
  );
}
