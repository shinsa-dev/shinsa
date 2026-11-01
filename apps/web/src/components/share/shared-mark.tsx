import type { Task } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Hint } from '@/components/overlays/hint.tsx';
import { isTaskShared, SHARED_MARK_LABEL } from '@/lib/share/dialog.ts';

export function SharedMark({ task }: { task: Task }) {
  if (!isTaskShared(task)) return null;
  return (
    <Hint label={SHARED_MARK_LABEL}>
      <span
        role='img'
        aria-label={SHARED_MARK_LABEL}
        className='inline-flex shrink-0 -translate-y-[0.5px] text-primary-text'
      >
        <Icon size='sm' name='IconLiveFull' />
      </span>
    </Hint>
  );
}
