'use client';

import { INDICATOR_TRANSITION, useAnimatedIndicator } from '@shinsa/ui/hooks/use-animated-indicator';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

const INDICATOR_STYLE: React.CSSProperties = {
  transition: INDICATOR_TRANSITION,
  willChange: 'transform, opacity',
  contain: 'layout paint',
  transformOrigin: 'center',
};

/**
 * Menu/list wrapper: a relative container with one absolutely positioned
 * indicator that slides to the `data-highlighted` item on the movement clock
 * (transform only, see `useAnimatedIndicator`). Items draw no highlight
 * background of their own. Owns the list padding so the indicator can sit
 * flush inside the popup's edge.
 *
 * When a wrapper div isn't possible (e.g. inside Base UI's Tabs.List, which
 * expects Tab children directly), use `useAnimatedIndicator` directly.
 */
function HighlightList({
  children,
  className,
  indicatorClassName,
  attribute,
  press,
}: {
  children: React.ReactNode;
  className?: string;
  indicatorClassName?: string;
  attribute?: string;
  press?: boolean;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = useAnimatedIndicator(rootRef, { attribute, press });

  return (
    <div ref={rootRef} className={cn('relative isolate p-1', className)}>
      <div
        ref={indicatorRef}
        aria-hidden
        data-slot='highlight-indicator'
        data-motion='move'
        className={cn(
          'pointer-events-none absolute top-0 left-0 -z-10 rounded-item bg-bg-a2 opacity-0',
          indicatorClassName
        )}
        style={INDICATOR_STYLE}
      />
      {children}
    </div>
  );
}

/**
 * The menu highlight for a plain list (a sidebar, a nav): one shared surface
 * that slides to the hovered `[data-highlight-item]` and
 * rests on the current one (`data-active="true"`) when the pointer leaves.
 * Items draw no hover or selected background of their own.
 */
function HoverHighlight({
  children,
  className,
  indicatorClassName,
}: {
  children: React.ReactNode;
  className?: string;
  indicatorClassName?: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = useAnimatedIndicator(rootRef, { attribute: 'data-hovered', parkWhenEmpty: true });

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let pointerInside = false;
    const mark = (item: Element | null) => {
      for (const marked of root.querySelectorAll('[data-hovered]')) {
        if (marked !== item) marked.removeAttribute('data-hovered');
      }
      item?.setAttribute('data-hovered', '');
    };
    const rest = () => mark(root.querySelector('[data-highlight-item][data-active="true"]'));
    const itemFrom = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('[data-highlight-item]') : null;
    const onOver = (event: PointerEvent) => {
      pointerInside = true;
      const item = itemFrom(event.target);
      if (item) mark(item);
      else rest();
    };
    const onLeave = () => {
      pointerInside = false;
      rest();
    };
    const observer = new MutationObserver(() => {
      if (!pointerInside) rest();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-active'],
    });
    rest();
    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerleave', onLeave);
    return () => {
      observer.disconnect();
      root.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div ref={rootRef} className={cn('relative isolate', className)}>
      <div
        ref={indicatorRef}
        aria-hidden
        data-slot='highlight-indicator'
        data-motion='move'
        className={cn(
          'pointer-events-none absolute top-0 left-0 -z-10 rounded-control bg-bg-a2 opacity-0',
          indicatorClassName
        )}
        style={INDICATOR_STYLE}
      />
      {children}
    </div>
  );
}

export { HighlightList, HoverHighlight, useAnimatedIndicator };
