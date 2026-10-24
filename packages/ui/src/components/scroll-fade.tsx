'use client';

import { resolveOverflowEdges } from '@shinsa/ui/lib/scroll';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';

type Orientation = 'vertical' | 'horizontal' | 'both';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

type ScrollFadeProps = Omit<React.ComponentProps<'div'>, 'ref'> & {
  orientation?: Orientation;
  /** Fade size in px (or any CSS length). */
  size?: number | string;
  /**
   * Ref of an existing scroll container to decorate. The fade is applied to
   * that element directly, so it needs no wrapper and nothing renders here.
   * Render this after the target, so its ref is attached when the fade is
   * applied. Omit it to have this component render its own scroll container
   * from `children`.
   */
  targetRef?: React.RefObject<HTMLElement | null>;
};

/**
 * Fades the scrollable edges of a plain overflow container. Prefer `ScrollArea`
 * when you also want a custom scrollbar; reach for this when the scrolling
 * element is native (or owned by something else) and only needs the fades.
 *
 * The fade is a mask on the scrolling element, so it works on any surface and
 * stays strictly inside the scrolling area — it never paints over a border.
 */
function ScrollFade({
  orientation = 'vertical',
  size = 24,
  targetRef,
  className,
  children,
  ...props
}: ScrollFadeProps) {
  const internalRef = React.useRef<HTMLDivElement>(null);
  const ref = (targetRef ?? internalRef) as React.RefObject<HTMLElement | null>;
  const dim = typeof size === 'number' ? `${size}px` : size;

  // A layout effect, so the fades are set before the first paint. React
  // attaches refs in tree order during the same pass, which is why a caller's
  // target must come before this component. The fallback avoids the SSR
  // warning about layout effects on the server.
  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const vertical = orientation === 'vertical' || orientation === 'both';
    const horizontal = orientation === 'horizontal' || orientation === 'both';
    // A caller-supplied target doesn't get our className, so opt it in here.
    el.classList.add('scroll-fade');
    el.setAttribute('data-fade-orientation', orientation);
    el.style.setProperty('--fade-size', dim);

    const update = () => {
      const y = resolveOverflowEdges(el.scrollTop, el.clientHeight, el.scrollHeight);
      const x = resolveOverflowEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
      el.toggleAttribute('data-overflow-y-start', vertical && y.start);
      el.toggleAttribute('data-overflow-y-end', vertical && y.end);
      el.toggleAttribute('data-overflow-x-start', horizontal && x.start);
      el.toggleAttribute('data-overflow-x-end', horizontal && x.end);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
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
      mutations.disconnect();
      observer.disconnect();
      if (targetRef) el.classList.remove('scroll-fade');
      el.removeAttribute('data-fade-orientation');
      el.style.removeProperty('--fade-size');
      for (const attr of ['y-start', 'y-end', 'x-start', 'x-end']) {
        el.removeAttribute(`data-overflow-${attr}`);
      }
    };
  }, [ref, orientation, dim]);

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
        ref={internalRef}
        data-slot='scroll-fade-viewport'
        data-fade-orientation={orientation}
        style={{ '--fade-size': dim } as React.CSSProperties}
        className={cn('scroll-fade scrollbar-hide size-full rounded-[inherit]', overflow)}
      >
        {children}
      </div>
    </div>
  );
}

export { ScrollFade };
