'use client';

import { PreviewCard as PreviewCardPrimitive } from '@base-ui/react/preview-card';
import { appendSample, isHeadingInto, type PointerSample } from '@shinsa/ui/lib/pointer-intent';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

/*
 * Preview cards behave as a group, like tooltips: once one is open, moving to
 * another trigger swaps the card instantly — no open delay, no exit or enter
 * animation, and the previous card closes the moment the next one opens. The
 * group stays warm for a short grace period after the last card closes so a
 * quick hop between rows still reads as one continuous hover.
 *
 * Moving toward the open card is forgiving: a trigger the pointer crosses on
 * its way there does not steal the card. The switch waits while the pointer is
 * still heading at the open card (`lib/pointer-intent.ts`), and happens as soon
 * as it settles on the new trigger instead.
 */
const GROUP_GRACE_MS = 300;
const SETTLE_MS = 90;
const MAX_DEFERS = 6;
const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 120;
const SIDE_OFFSET_PX = 8;

let grouped = false;
let active: { close: () => void; popup: React.RefObject<HTMLDivElement | null> } | null = null;
let release: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

let samples: PointerSample[] = [];
let tracking = false;

function trackPointer() {
  if (tracking) return;
  tracking = true;
  document.addEventListener(
    'pointermove',
    (event) => {
      samples = appendSample(samples, { x: event.clientX, y: event.clientY, t: performance.now() });
    },
    { passive: true, capture: true }
  );
}

function updateGrouped(next: boolean) {
  if (grouped === next) return;
  grouped = next;
  for (const listener of listeners) listener();
}

function coolDown() {
  clearTimeout(release);
  release = setTimeout(() => updateGrouped(false), GROUP_GRACE_MS);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useGrouped() {
  return React.useSyncExternalStore(
    subscribe,
    () => grouped,
    () => false
  );
}

const CardContext = React.createContext<{ instant: boolean; popup: React.RefObject<HTMLDivElement | null> }>({
  instant: false,
  popup: { current: null },
});

type OpenChange = NonNullable<PreviewCardPrimitive.Root.Props['onOpenChange']>;

/** The group owns whether a card is open, so `open` and `defaultOpen` are not accepted. */
function PreviewCard({
  onOpenChange,
  ...props
}: Omit<PreviewCardPrimitive.Root.Props, 'open' | 'defaultOpen'>) {
  const [open, setOpen] = React.useState(false);
  const [instant, setInstant] = React.useState(false);
  const popup = React.useRef<HTMLDivElement | null>(null);
  const pending = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const closeNow = React.useCallback(() => {
    clearTimeout(pending.current);
    setInstant(true);
    setOpen(false);
  }, []);

  React.useEffect(() => {
    trackPointer();
    return () => {
      clearTimeout(pending.current);
      if (active?.close !== closeNow) return;
      active = null;
      coolDown();
    };
  }, [closeNow]);

  const openNow = (details: Parameters<OpenChange>[1]) => {
    const switching = grouped;
    if (active && active.close !== closeNow) active.close();
    active = { close: closeNow, popup };
    clearTimeout(release);
    setInstant(switching);
    updateGrouped(true);
    setOpen(true);
    onOpenChange?.(true, details);
  };

  const otherPopup = () => (active && active.close !== closeNow ? active.popup.current : null);

  const handleOpenChange: OpenChange = (next, details) => {
    clearTimeout(pending.current);
    if (next) {
      const target = details.event?.target;
      const trigger = target instanceof Element ? target.closest('[data-slot=preview-card-trigger]') : null;
      const other = otherPopup();
      if (!(trigger && other && isHeadingInto(samples, other.getBoundingClientRect()))) {
        openNow(details);
        return;
      }
      let defers = 0;
      const settle = () => {
        if (!trigger.matches(':hover')) return;
        const current = otherPopup();
        if (current && defers < MAX_DEFERS && isHeadingInto(samples, current.getBoundingClientRect())) {
          defers += 1;
          pending.current = setTimeout(settle, SETTLE_MS);
          return;
        }
        openNow(details);
      };
      pending.current = setTimeout(settle, SETTLE_MS);
      return;
    }
    if (!open) return;
    if (active?.close === closeNow) active = null;
    setInstant(false);
    coolDown();
    setOpen(false);
    onOpenChange?.(false, details);
  };

  return (
    <CardContext.Provider value={{ instant, popup }}>
      <PreviewCardPrimitive.Root
        data-slot='preview-card'
        {...props}
        open={open}
        onOpenChange={handleOpenChange}
      />
    </CardContext.Provider>
  );
}

function PreviewCardTrigger({
  delay = OPEN_DELAY_MS,
  closeDelay = CLOSE_DELAY_MS,
  ...props
}: PreviewCardPrimitive.Trigger.Props) {
  const warm = useGrouped();
  return (
    <PreviewCardPrimitive.Trigger
      data-slot='preview-card-trigger'
      delay={warm ? 0 : delay}
      closeDelay={closeDelay}
      {...props}
    />
  );
}

function PreviewCardContent({
  className,
  side = 'bottom',
  sideOffset = SIDE_OFFSET_PX,
  align = 'start',
  children,
  ...props
}: PreviewCardPrimitive.Popup.Props &
  Pick<PreviewCardPrimitive.Positioner.Props, 'side' | 'sideOffset' | 'align'>) {
  const { instant, popup } = React.useContext(CardContext);
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        className='isolate z-50'
        side={side}
        sideOffset={sideOffset}
        align={align}
      >
        <PreviewCardPrimitive.Popup
          ref={popup}
          data-slot='preview-card-content'
          data-instant={instant ? '' : undefined}
          className={cn(
            'corner-superellipse/1.125 data-open:fade-in-0 data-open:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 flex w-72 origin-(--transform-origin) flex-col rounded-popup bg-popover text-popover-foreground text-xs shadow-md outline-hidden data-closed:animate-out data-open:animate-in',
            'data-instant:animate-none! data-instant:duration-0!',
            className
          )}
          {...props}
        >
          {children}
        </PreviewCardPrimitive.Popup>
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { PreviewCard, PreviewCardContent, PreviewCardTrigger };
