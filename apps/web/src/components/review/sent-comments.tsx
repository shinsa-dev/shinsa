import type { ReviewComment } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import { describeCommentPlace } from '@/lib/review/draft.ts';

export function SentComments({ comments, className }: { comments: ReviewComment[]; className?: string }) {
  return (
    <ul aria-label='Line comments' className={cn('flex flex-col gap-1 pt-0.5', className)}>
      {comments.map((comment) => (
        <li key={`${describeCommentPlace(comment)}:${comment.text}`} className='flex flex-col gap-px text-xs'>
          <span className='font-mono text-2xs text-fg-2'>{describeCommentPlace(comment)}</span>
          <span className='text-fg-4'>{comment.text}</span>
        </li>
      ))}
    </ul>
  );
}
