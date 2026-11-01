import type { ShinsaState } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Icon } from '@shinsa/ui/components/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@shinsa/ui/components/popover';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { FEEDBACK_POPOVER, FeedbackPanel } from '@/components/feedback/popover.tsx';
import { NAV_ICON_NUDGE } from '@/components/layout/nav-button.tsx';
import { NAV_ITEM } from '@/components/layout/nav-item.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  countFeedbackWaiting,
  describeFeedbackCount,
  FEEDBACK_ACTIONS,
  FEEDBACK_ACTIVE_ICON,
  FEEDBACK_HINT,
  FEEDBACK_ICON,
  type FeedbackActions,
  openFeedbackEntry,
  registerFeedbackOpener,
  updateFeedbackOpen,
  useFeedbackOpen,
} from '@/lib/feedback.ts';

export function FeedbackButton({
  state,
  variant = 'bar',
  className,
  actions = FEEDBACK_ACTIONS,
  onNavigate,
}: {
  state: ShinsaState;
  variant?: 'bar' | 'rail';
  className?: string;
  actions?: FeedbackActions;
  onNavigate?: () => void;
}) {
  const openerId = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(
    () => registerFeedbackOpener(openerId, () => (triggerRef.current?.getClientRects().length ?? 0) > 0),
    [openerId]
  );
  const open = useFeedbackOpen(openerId);
  const count = describeFeedbackCount(countFeedbackWaiting(state));
  const icon = open ? FEEDBACK_ACTIVE_ICON : FEEDBACK_ICON;
  const trigger =
    variant === 'rail' ? (
      <PopoverTrigger
        ref={triggerRef}
        render={<button type='button' data-active={open} data-highlight-item='' className={NAV_ITEM} />}
      >
        <span className='grid size-5 shrink-0 place-items-center'>
          <Icon size='md' name={icon} />
        </span>
        <span className='flex-1 truncate'>Feedback</span>
        {count && <span className='text-2xs text-primary-text tabular-nums'>{count}</span>}
      </PopoverTrigger>
    ) : (
      <Hint label={FEEDBACK_HINT}>
        <PopoverTrigger
          ref={triggerRef}
          render={
            <Button
              variant='secondary'
              size='sm'
              icon={{ name: icon, className: NAV_ICON_NUDGE }}
              className={cn(open ? 'text-fg-4' : 'text-fg-3', className)}
            />
          }
        >
          Feedback
          {count && <span className='text-primary-text tabular-nums'>{count}</span>}
        </PopoverTrigger>
      </Hint>
    );
  return (
    <Popover open={open} onOpenChange={(next) => updateFeedbackOpen(openerId, next)}>
      {trigger}
      <PopoverContent
        align={variant === 'rail' ? 'start' : 'end'}
        side={variant === 'rail' ? 'right' : 'bottom'}
        sideOffset={6}
        collisionAvoidance={variant === 'rail' ? undefined : { fallbackAxisSide: 'none' }}
        className={FEEDBACK_POPOVER}
      >
        <FeedbackPanel
          state={state}
          actions={actions}
          onOpen={(entry) => {
            openFeedbackEntry(entry.id);
            onNavigate?.();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
