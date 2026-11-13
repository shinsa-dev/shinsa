import type { Task } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { resolveReviewRatingsView } from '@/lib/autopilot.ts';

export function ReviewRatings({ task }: { task: Pick<Task, 'reviewRatings' | 'autopiloted'> }) {
  const view = resolveReviewRatingsView(task);
  if (!view) return null;
  return (
    <div className='flex flex-wrap items-center gap-1.5'>
      {view.badges.map((badge) => (
        <Badge key={badge.key} variant={badge.tone} icon={badge.icon}>
          {badge.label}
        </Badge>
      ))}
      {view.hint && <span className='text-xs text-fg-3'>{view.hint}</span>}
    </div>
  );
}
