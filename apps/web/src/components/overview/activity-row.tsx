import type { Activity, ReviewComment, ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import type * as React from 'react';
import { InAppLink } from '@/components/links/link.tsx';
import { UserTag } from '@/components/people/user-tag.tsx';
import { StatusTile } from '@/components/status/tile.tsx';
import { useReadOnlyOwner } from '@/components/task/read-only.tsx';
import { InlineMarkdown, Markdown } from '@/components/text/markdown.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import {
  type ActivityActor,
  listActivityDetail,
  resolveActivityActor,
  resolveActivityGlyph,
} from '@/lib/overview/activity.ts';
import { describeCommentPlace } from '@/lib/review/draft.ts';
import type { Glyph } from '@/lib/tasks/status.ts';
import { resolveTaskPath, resolveTaskTarget } from '@/router.ts';

function ActorLabel({ state, actor }: { state: ShinsaState; actor: ActivityActor }) {
  if (!actor.taskId) return actor.label;
  return (
    <InAppLink
      path={resolveTaskPath(resolveTaskTarget(state, actor.taskId))}
      className='text-fg-2 hover:text-fg-4 active:text-fg-4'
    >
      {actor.label}
    </InAppLink>
  );
}

function SentComments({ comments }: { comments: ReviewComment[] }) {
  return (
    <ul className='flex flex-col gap-1 pt-0.5'>
      {comments.map((comment) => (
        <li key={`${describeCommentPlace(comment)}:${comment.text}`} className='flex flex-col gap-px text-xs'>
          <span className='font-mono text-2xs text-fg-2'>{describeCommentPlace(comment)}</span>
          <span className='text-fg-4'>{comment.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ActivityEntry({
  glyph,
  text,
  actor,
  at,
  detail,
  children,
}: {
  glyph: Glyph;
  text: string;
  actor: React.ReactNode;
  at: number;
  detail: readonly string[];
  children?: React.ReactNode;
}) {
  return (
    <li className='group relative flex gap-3 pb-4 last:pb-0'>
      <span aria-hidden className='absolute top-6 bottom-0 left-2.5 w-px bg-border group-last:hidden' />
      <StatusTile {...glyph} className='relative' />
      <div className='flex min-w-0 flex-1 flex-col gap-px'>
        <div className='flex items-baseline gap-2 text-xs leading-5'>
          <InlineMarkdown text={text} className='font-medium text-fg-3' />
          <span className='ms-auto shrink-0 text-2xs text-fg-2'>
            {actor} · <TimeAgo at={at} compact />
          </span>
        </div>
        {detail.map((line) => (
          <div key={line} className='line-clamp-2'>
            <Markdown text={line} className='text-fg-4 text-xs' />
          </div>
        ))}
        {children}
      </div>
    </li>
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
  const owner = useReadOnlyOwner();
  return (
    <ActivityEntry
      glyph={resolveActivityGlyph(entry)}
      text={entry.text}
      actor={
        entry.actor === 'you' && !entry.onBehalf && owner?.user ? (
          <UserTag user={owner.user} label={owner.name} />
        ) : (
          <ActorLabel state={state} actor={resolveActivityActor(state, entry, owner?.name ?? null)} />
        )
      }
      at={entry.at}
      detail={listActivityDetail(entry)}
    >
      {entry.comments && entry.comments.length > 0 && <SentComments comments={entry.comments} />}
      {run && (
        <button
          type='button'
          onClick={() => onOpenRun(run.id)}
          className='flex w-fit cursor-pointer items-center gap-1 text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
        >
          Open in chat
          <Icon size='sm' name='IconChevronRightSmall' />
        </button>
      )}
    </ActivityEntry>
  );
}
