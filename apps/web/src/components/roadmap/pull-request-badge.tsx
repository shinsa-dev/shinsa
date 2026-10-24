import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { describePullRequestChecks, resolvePullRequestTone } from '@/lib/tasks/pull-request.ts';

export function PullRequestBadge({ task }: { task: Task }) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  const checks = describePullRequestChecks(pullRequest);
  return (
    <Hint
      label={
        <span className='whitespace-nowrap'>
          <TooltipLabel>Pull request</TooltipLabel> #{pullRequest.number}
          <TooltipLabel> · </TooltipLabel>
          <span className={TONE_TEXT[checks.tone]}>{checks.label}</span>
        </span>
      }
    >
      <a
        href={pullRequest.url}
        target='_blank'
        rel='noreferrer'
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'corner-superellipse/1.125 inline-flex h-5 items-center gap-1 rounded-control-sm bg-bg-a2 px-1.5 font-medium text-2xs tabular-nums transition-colors duration-150 hover:bg-bg-a3 active:bg-bg-a3',
          TONE_TEXT[resolvePullRequestTone(pullRequest)]
        )}
      >
        <Icon name={pullRequest.state === 'merged' ? 'IconMerged' : 'IconPullRequest'} className='size-3' />
        {pullRequest.number}
      </a>
    </Hint>
  );
}
