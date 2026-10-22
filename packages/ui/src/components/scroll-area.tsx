'use client';

import {
  resolveDragScrollTop,
  resolveOverflowEdges,
  resolveThumb,
  resolveTrackScrollTop,
} from '@shinsa/ui/lib/scroll';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

const LINGER_MS = 700;

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) (ref as React.RefObject<T | null>).current = value;
}

/**
 * A scrolling region with an overlay scrollbar. Scrolling is the browser's
 * own (wheel, trackpad, keyboard, momentum); the thumb is moved straight on
 * the DOM in the scroll event with a transform, so scrolling never re-renders
 * React and the thumb stays in step on long content. It shows while the
 * region scrolls or the pointer is over it, lingers briefly, widens under
 * the pointer and can be dragged. The geometry lives in `lib/scroll.ts`.
 */
function ScrollArea({
  className,
  children,
  fade = true,
  viewportRef,
  viewportClassName,
  onScroll,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onScroll'> & {
  /** Fade the content out at whichever edges can still be scrolled. */
  fade?: boolean;
  /** The element that scrolls, for reading and setting the scroll position. */
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportClassName?: string;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
}) {
  const viewport = React.useRef<HTMLDivElement | null>(null);
  const track = React.useRef<HTMLDivElement>(null);
  const thumb = React.useRef<HTMLDivElement>(null);
  const frame = React.useRef(0);
  const hide = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = React.useRef<{ startY: number; startTop: number } | null>(null);

  const attachViewport = React.useCallback(
    (node: HTMLDivElement | null) => {
      viewport.current = node;
      assignRef(viewportRef, node);
    },
    [viewportRef]
  );

  const paint = React.useCallback(() => {
    frame.current = 0;
    const view = viewport.current;
    const bar = track.current;
    const handle = thumb.current;
    if (!view || !bar || !handle) return;
    const { scrollTop, scrollHeight, clientHeight } = view;
    if (fade) {
      const edges = resolveOverflowEdges(scrollTop, clientHeight, scrollHeight);
      view.toggleAttribute('data-overflow-y-start', edges.start);
      view.toggleAttribute('data-overflow-y-end', edges.end);
    }
    const geometry = resolveThumb({ scrollTop, scrollHeight, clientHeight });
    bar.toggleAttribute('data-hidden', geometry === null);
    if (!geometry) return;
    handle.style.height = `${geometry.size}px`;
    handle.style.transform = `translate3d(0, ${geometry.offset}px, 0)`;
  }, [fade]);

  const schedule = React.useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  const reveal = React.useCallback(() => {
    const bar = track.current;
    if (!bar) return;
    bar.setAttribute('data-scrolling', '');
    clearTimeout(hide.current);
    hide.current = setTimeout(() => {
      if (!drag.current) bar.removeAttribute('data-scrolling');
    }, LINGER_MS);
  }, []);

  React.useLayoutEffect(() => {
    const view = viewport.current;
    if (!view) return;
    paint();
    const observer = new ResizeObserver(schedule);
    const observeChildren = () => {
      for (const child of Array.from(view.children)) observer.observe(child);
    };
    observer.observe(view);
    observeChildren();
    const mutations = new MutationObserver(() => {
      observeChildren();
      schedule();
    });
    mutations.observe(view, { childList: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      clearTimeout(hide.current);
    };
  }, [paint, schedule]);

  function onThumbDown(event: React.PointerEvent<HTMLDivElement>) {
    const view = viewport.current;
    if (!view) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startY: event.clientY, startTop: view.scrollTop };
    track.current?.setAttribute('data-dragging', '');
  }

  function onThumbMove(event: React.PointerEvent<HTMLDivElement>) {
    const view = viewport.current;
    const state = drag.current;
    if (!view || !state) return;
    view.scrollTop = resolveDragScrollTop(view, state.startTop, event.clientY - state.startY);
  }

  function onThumbUp(event: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    track.current?.removeAttribute('data-dragging');
    reveal();
  }

  function onTrackDown(event: React.PointerEvent<HTMLDivElement>) {
    const view = viewport.current;
    if (!view || event.target !== event.currentTarget) return;
    const top = event.currentTarget.getBoundingClientRect().top;
    view.scrollTo({ top: resolveTrackScrollTop(view, event.clientY - top), behavior: 'smooth' });
  }

  return (
    <div data-slot='scroll-area' className={cn('relative overflow-hidden', className)} {...props}>
      <div
        ref={attachViewport}
        data-slot='scroll-area-viewport'
        onScroll={(event) => {
          paint();
          reveal();
          onScroll?.(event);
        }}
        className={cn(
          'size-full overflow-y-auto overflow-x-hidden rounded-[inherit] outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          fade && 'scroll-fade',
          viewportClassName
        )}
      >
        {children}
      </div>
      <div
        ref={track}
        aria-hidden
        data-slot='scroll-area-scrollbar'
        onPointerDown={onTrackDown}
        className='group/scrollbar absolute inset-y-0 right-0 z-20 w-3 py-1 pr-0.75 pl-1 opacity-0 transition-[opacity,padding] delay-300 duration-200 hover:pl-0.5 hover:opacity-100 hover:delay-0 active:pl-0.5 active:opacity-100 active:delay-0 data-hidden:hidden data-dragging:pl-0.5 data-dragging:opacity-100 data-scrolling:opacity-100 data-scrolling:delay-0'
      >
        <div
          ref={thumb}
          data-slot='scroll-area-thumb'
          onPointerDown={onThumbDown}
          onPointerMove={onThumbMove}
          onPointerUp={onThumbUp}
          onPointerCancel={onThumbUp}
          className='w-full touch-none rounded-full bg-fg-a1 opacity-60 transition-opacity duration-150 will-change-transform group-hover/scrollbar:opacity-100 group-active/scrollbar:opacity-100 group-data-dragging/scrollbar:opacity-100'
        />
      </div>
    </div>
  );
}

export { ScrollArea };
