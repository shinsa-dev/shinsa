import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { TooltipLabel } from '@shinsa/ui/components/tooltip';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { TONE_SURFACE, TONE_SURFACE_HOVER, TONE_TEXT } from '@/lib/format/tone.ts';
import { describePullRequestChecks, resolvePullRequestTone } from '@/lib/tasks/pull-request.ts';

export function PullRequestBadge({ task }: { task: Task }) {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  const checks = describePullRequestChecks(pullRequest);
  const tone = resolvePullRequestTone(pullRequest);
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
          'corner-superellipse/1.125 inline-flex h-5 items-center gap-1 rounded-control-sm px-1.5 font-medium text-2xs tabular-nums transition-colors duration-150',
          TONE_SURFACE[tone],
          TONE_SURFACE_HOVER[tone]
        )}
      >
        <Icon size='sm' name={pullRequest.state === 'merged' ? 'IconMerged' : 'IconPullRequest'} />
        {pullRequest.number}
      </a>
    </Hint>
  );
}
