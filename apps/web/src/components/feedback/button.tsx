import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { cn } from '@shinsa/ui/lib/utils';
import { NAV_ICON_NUDGE } from '@/components/layout/nav-button.tsx';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  countFeedbackWaiting,
  describeFeedbackCount,
  FEEDBACK_ACTIVE_ICON,
  FEEDBACK_HINT,
  FEEDBACK_ICON,
  openFeedback,
  useFeedbackOpen,
} from '@/lib/feedback.ts';

export function FeedbackButton({
  state,
  variant = 'bar',
  className,
  onNavigate,
}: {
  state: ShinsaState;
  variant?: 'bar' | 'rail';
  className?: string;
  onNavigate?: () => void;
}) {
  const open = useFeedbackOpen();
  const count = describeFeedbackCount(countFeedbackWaiting(state));
  const icon = open ? FEEDBACK_ACTIVE_ICON : FEEDBACK_ICON;
  function press() {
    openFeedback();
    onNavigate?.();
  }
  if (variant === 'rail')
    return (
      <button type='button' data-active={open} data-highlight-item='' onClick={press} className={NAV_ITEM}>
        <span className='grid size-5 shrink-0 place-items-center'>
          <Icon size='md' name={icon} />
        </span>
        <span className='flex-1 truncate'>Feedback</span>
        {count && <span className='text-2xs text-primary-text tabular-nums'>{count}</span>}
      </button>
    );
  return (
    <Hint label={FEEDBACK_HINT}>
      <Button
        variant='secondary'
        size='sm'
        icon={{ name: icon, className: NAV_ICON_NUDGE }}
        className={cn(open ? 'text-fg-4' : 'text-fg-3', className)}
        onClick={press}
      >
        Feedback
        {count && <span className='text-primary-text tabular-nums'>{count}</span>}
      </Button>
    </Hint>
  );
}
