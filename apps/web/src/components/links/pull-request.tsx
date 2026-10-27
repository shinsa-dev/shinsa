import type { ShinsaState, Task } from '@shinsa/core';
import { ChecksSections } from '@/components/checks/checks-list.tsx';
import { GlyphLabel, INLINE_TILE, SMART_LINK } from '@/components/links/link.tsx';
import { TaskPopoverRows } from '@/components/links/task.tsx';
import {
  InfoAction,
  InfoHeader,
  InfoPopover,
  InfoRow,
  InfoSection,
} from '@/components/overlays/info-popover.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { resolveChecksView } from '@/lib/tasks/checks.ts';
import {
  describeMergeable,
  describePullRequestState,
  resolvePullRequestTone,
} from '@/lib/tasks/pull-request.ts';

export function PullRequestDetails({
  state,
  task,
  showTask = false,
}: {
  state: ShinsaState;
  task: Task;
  showTask?: boolean;
}) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  const checks = resolveChecksView(state, task);
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
      {checks && <ChecksSections view={checks} />}
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
      <PullRequestDetails state={state} task={task} showTask />
    </InfoPopover>
  );
}
