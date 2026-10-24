import type { Activity, ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { InAppLink } from '@/components/links/link.tsx';
import { EvidenceItem } from '@/components/overview/evidence-item.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { type ActivityActor, resolveActivityActor, resolveActivityGlyph } from '@/lib/overview/activity.ts';
import { isVisualEvidence } from '@/lib/overview/evidence.ts';
import { resolveTaskPath, resolveTaskTarget } from '@/router.ts';

function ActorLabel({ state, actor }: { state: ShinsaState; actor: ActivityActor }) {
  if (!actor.taskId) return actor.label;
  return (
    <InAppLink
      path={resolveTaskPath(resolveTaskTarget(state, actor.taskId))}
      className='text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
    >
      {actor.label}
    </InAppLink>
  );
}

export function ActivityRow({
  entry,
  state,
  onOpenRun,
}: {
  entry: Activity;
  state: ShinsaState;
  onOpenRun: (runId: string) => void;
}) {
  const run = entry.runId ? state.runs[entry.runId] : undefined;
  const evidence = entry.evidenceId ? state.evidence[entry.evidenceId] : undefined;
  return (
    <li className='group relative flex gap-3 pb-4 last:pb-0'>
      <span aria-hidden className='absolute top-6 bottom-0 left-2.5 w-px bg-border group-last:hidden' />
      <StatusTile {...resolveActivityGlyph(entry)} className='relative' />
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <div className='flex items-baseline gap-2 text-xs leading-5'>
          <InlineMarkdown text={entry.text} className='font-medium text-fg-3' />
          <span className='ms-auto shrink-0 text-2xs text-fg-2'>
            <ActorLabel state={state} actor={resolveActivityActor(state, entry)} /> ·{' '}
            <TimeAgo at={entry.at} compact />
          </span>
        </div>
        {entry.detail && (
          <div className='line-clamp-2'>
            <Markdown text={entry.detail} className='text-fg-4 text-xs' />
          </div>
        )}
        {run && (
          <button
            type='button'
            onClick={() => onOpenRun(run.id)}
            className='flex w-fit cursor-pointer items-center gap-1 text-2xs text-fg-2 transition-colors duration-150 hover:text-fg-4 active:text-fg-4'
          >
            Open in chat
            <Icon name='IconChevronRightSmall' className='size-3.5' />
          </button>
        )}
        {evidence && isVisualEvidence(evidence.uri) && (
          <div className='max-w-sm'>
            <EvidenceItem evidence={evidence} />
          </div>
        )}
      </div>
    </li>
  );
}
