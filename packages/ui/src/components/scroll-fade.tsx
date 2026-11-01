'use client';

import { resolveFadeTimelines, resolveOverflowEdges } from '@shinsa/ui/lib/scroll';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

type Orientation = 'vertical' | 'horizontal' | 'both';

const FIELD_TOLERANCE = 8;

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

type ScrollFadeProps = Omit<React.ComponentProps<'div'>, 'ref'> & {
  orientation?: Orientation;
  /** Fade size in px (or any CSS length): 24 by default, 16 on a `targetRef`. */
  size?: number | string;
  /**
   * Ref of an existing scroll container to decorate, such as a `textarea`.
   * The fade is applied to that element directly, so it needs no wrapper and
   * nothing renders here. Render this after the target, so its ref is
   * attached when the fade is applied. Omit it to have this component render
   * its own scroll container from `children`.
   *
   * A target is treated as a text field: its fades follow only the measured
   * edges (`data-fade-static`, no scroll timeline), they update on `input`,
   * and an edge hiding no more than `FIELD_TOLERANCE` px (the field's own
   * padding, which a caret scroll leaves out of view) does not fade.
   */
  targetRef?: React.RefObject<HTMLElement | null>;
};

/**
 * Fades the scrollable edges of a plain overflow container. Prefer `ScrollArea`
 * when you also want a custom scrollbar; reach for this when the scrolling
 * element is native (or owned by something else) and only needs the fades.
 *
 * The fade is a mask, so it works on any surface and stays strictly inside the
 * scrolling area — it never paints over a border. On its own scroller it masks
 * a still box around it, so scrolling never repaints the content; on a
 * `targetRef` it masks the target itself (`scroll-fade` in globals.css).
 */
function ScrollFade({
  orientation = 'vertical',
  size,
  targetRef,
  className,
  children,
  ...props
}: ScrollFadeProps) {
  const internalRef = React.useRef<HTMLDivElement>(null);
  const maskRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const timelines = React.useMemo(() => resolveFadeTimelines(id), [id]);
  const ref = (targetRef ?? internalRef) as React.RefObject<HTMLElement | null>;
  const resolved = size ?? (targetRef ? 16 : 24);
  const dim = typeof resolved === 'number' ? `${resolved}px` : resolved;

  // A layout effect, so the fades are set before the first paint. React
  // attaches refs in tree order during the same pass, which is why a caller's
  // target must come before this component. The fallback avoids the SSR
  // warning about layout effects on the server.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    const masked = targetRef ? el : maskRef.current;
    if (!el || !masked) return;

    const vertical = orientation === 'vertical' || orientation === 'both';
    const horizontal = orientation === 'horizontal' || orientation === 'both';
    // A caller-supplied target doesn't get our className, so opt it in here:
    // it is both the mask and the scroller it reads. A scroll timeline on the
    // field itself keeps its last fade once the text stops overflowing, so the
    // field's fades come from the measured edges alone.
    if (targetRef) {
      el.classList.add('scroll-fade');
      el.setAttribute('data-fade-static', '');
    }
    masked.setAttribute('data-fade-orientation', orientation);
    masked.style.setProperty('--fade-size', dim);
    const tolerance = targetRef ? FIELD_TOLERANCE : 0;

    const update = () => {
      const y = resolveOverflowEdges(el.scrollTop, el.clientHeight, el.scrollHeight, tolerance);
      const x = resolveOverflowEdges(el.scrollLeft, el.clientWidth, el.scrollWidth, tolerance);
      masked.toggleAttribute('data-overflow-y-start', vertical && y.start);
      masked.toggleAttribute('data-overflow-y-end', vertical && y.end);
      masked.toggleAttribute('data-overflow-x-start', horizontal && x.start);
      masked.toggleAttribute('data-overflow-x-end', horizontal && x.end);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    // A field's value changes without a DOM mutation or always a resize.
    el.addEventListener('input', update);
    const observer = new ResizeObserver(update);
    observer.observe(el);
    const observed = new WeakSet<Element>();
    const observeChildren = () => {
      for (const child of Array.from(el.children)) {
        if (observed.has(child)) continue;
        observed.add(child);
        observer.observe(child);
      }
    };
    observeChildren();
    const mutations = new MutationObserver(() => {
      observeChildren();
      update();
    });
    mutations.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener('scroll', update);
      el.removeEventListener('input', update);
      mutations.disconnect();
      observer.disconnect();
      if (targetRef) {
        el.classList.remove('scroll-fade');
        el.removeAttribute('data-fade-static');
      }
      masked.removeAttribute('data-fade-orientation');
      masked.style.removeProperty('--fade-size');
      for (const attr of ['y-start', 'y-end', 'x-start', 'x-end']) {
        masked.removeAttribute(`data-overflow-${attr}`);
      }
    };
  }, [ref, targetRef, orientation, dim]);

  if (targetRef) return null;

  const overflow =
    orientation === 'vertical'
      ? 'overflow-y-auto'
      : orientation === 'horizontal'
        ? 'overflow-x-auto'
        : 'overflow-auto';

  return (
    <div className={cn('relative', className)} {...props}>
      <div
        ref={maskRef}
        data-slot='scroll-fade'
        data-fade-scope=''
        data-fade-orientation={orientation}
        style={{ ...timelines, '--fade-size': dim } as React.CSSProperties}
        className='scroll-fade size-full rounded-[inherit]'
      >
        <div
          ref={internalRef}
          data-slot='scroll-fade-viewport'
          className={cn('scroll-fade-source scrollbar-hide size-full rounded-[inherit]', overflow)}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export { ScrollFade };
