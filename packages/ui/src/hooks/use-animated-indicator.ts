import * as React from 'react';

export const INDICATOR_TRANSITION = 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out';

const PRESS_INSET = { x: 1, y: 0.5 };

type Box = { left: number; top: number; width: number; height: number };

/**
 * Walks the offsetParent chain up to `root` for the item's position in layout
 * coords. offset* values are whole pixels, so this is only the fallback for a
 * root that has no layout box to measure against.
 */
function walkOffsets(el: HTMLElement, root: HTMLElement): Box {
  let left = 0;
  let top = 0;
  let current: HTMLElement | null = el;
  while (current && current !== root) {
    left += current.offsetLeft;
    top += current.offsetTop;
    const next = current.offsetParent as HTMLElement | null;
    if (!next || !root.contains(next)) break;
    current = next;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight };
}

/**
 * The item's box in the root's layout coords, to the sub-pixel: rows of a
 * fractional height (two lines of text, say) would otherwise round the
 * indicator past their edge. Dividing by the root's scale undoes a popup's
 * open/close transform (zoom-in-95 etc.), which would otherwise land the
 * indicator mid-item, and the root's scroll offset keeps the box in the
 * scrolled content the indicator is positioned in.
 */
function measureItem(el: HTMLElement, root: HTMLElement): Box {
  if (!root.offsetWidth || !root.offsetHeight) return walkOffsets(el, root);
  const rootRect = root.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const scaleX = Math.abs(rootRect.width - root.offsetWidth) < 1 ? 1 : rootRect.width / root.offsetWidth;
  const scaleY = Math.abs(rootRect.height - root.offsetHeight) < 1 ? 1 : rootRect.height / root.offsetHeight;
  return {
    left: (rect.left - rootRect.left) / scaleX - root.clientLeft + root.scrollLeft,
    top: (rect.top - rootRect.top) / scaleY - root.clientTop + root.scrollTop,
    width: rect.width / scaleX,
    height: rect.height / scaleY,
  };
}

/**
 * Attaches a sliding indicator to any container whose items expose a
 * boolean-ish attribute (e.g. `data-highlighted`, `data-active`). Pure
 * imperative DOM — no React re-renders on hover/active change.
 *
 * The indicator moves on the compositor only: its position and its size
 * change through `transform` (a translate and a scale from the box it was
 * laid out at), on the movement clock (`INDICATOR_TRANSITION`). When a slide
 * ends on an item of another size, the indicator is laid out once at that
 * size and its scale drops back to 1, so its corners never rest stretched. An
 * indicator with no size yet (an item not measured) is laid out at once.
 * The item selected when it mounts shows at once, with no fade or slide; it
 * moves only when the selection changes after that. Cleaning up parks the
 * indicator, so a list hidden in a React `Activity` and shown again never
 * keeps a box over an item that left while it was hidden.
 *
 * Items get `data-indicator-here` while the indicator sits on them, so they
 * can style their own text/icon color for the highlighted state. The
 * indicator mirrors the item's `data-variant`, so a destructive row can tint
 * it. With `press`, pressing an item deflates the indicator by the same fixed
 * inset every control presses by (`--press-inset-*` in globals.css), in the
 * frame of the press: the slide's transition is held off while the press
 * scale lands and while it lifts.
 *
 * Usage:
 *   const rootRef = useRef<HTMLDivElement>(null);
 *   const indicatorRef = useAnimatedIndicator(rootRef, { attribute: 'data-active' });
 *   return (
 *     <div ref={rootRef} className='relative'>
 *       <div ref={indicatorRef} className='absolute rounded-item bg-bg-a2' />
 *       {children}
 *     </div>
 *   );
 */
export function useAnimatedIndicator<T extends HTMLElement>(
  rootRef: React.RefObject<T | null>,
  {
    attribute = 'data-highlighted',
    value,
    press = true,
    parkWhenEmpty = false,
  }: { attribute?: string; value?: string; press?: boolean; parkWhenEmpty?: boolean } = {}
): React.RefObject<HTMLDivElement | null> {
  const indicatorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    const indicator = indicatorRef.current;
    if (!root || !indicator) return;

    let hasAppeared = false;
    let mounting = true;
    let activeEl: HTMLElement | null = null;
    let laidOut = { width: 0, height: 0 };
    let target: Box = { left: 0, top: 0, width: 0, height: 0 };
    const selector = value === undefined ? `[${attribute}]` : `[${attribute}="${value}"]`;

    const applyTransform = () => {
      const x = target.left + (target.width - laidOut.width) / 2;
      const y = target.top + (target.height - laidOut.height) / 2;
      const scaleX = target.width / laidOut.width;
      const scaleY = target.height / laidOut.height;
      indicator.style.transform = `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY}) scale(var(--hl-press-scale, 1))`;
    };

    const layOut = () => {
      laidOut = { width: target.width, height: target.height };
      indicator.style.width = `${target.width}px`;
      indicator.style.height = `${target.height}px`;
      indicator.style.transform = `translate(${target.left}px, ${target.top}px) scale(1, 1) scale(var(--hl-press-scale, 1))`;
    };

    const snap = (change: () => void) => {
      const transition = indicator.style.transition;
      indicator.style.transition = 'none';
      change();
      void indicator.offsetWidth;
      indicator.style.transition = transition;
    };

    const park = () => {
      activeEl?.removeAttribute('data-indicator-here');
      activeEl = null;
      hasAppeared = false;
      laidOut = { width: 0, height: 0 };
      indicator.style.transition = 'none';
      indicator.style.opacity = '0';
      indicator.style.transform = '';
      indicator.style.width = '0px';
      indicator.style.height = '0px';
    };

    const update = () => {
      const el = root.querySelector<HTMLElement>(selector);
      if (!el) {
        if (activeEl && (parkWhenEmpty || !activeEl.isConnected)) park();
        return;
      }

      if (el !== activeEl) {
        activeEl?.removeAttribute('data-indicator-here');
        el.setAttribute('data-indicator-here', '');
        activeEl = el;
        const variant = el.getAttribute('data-variant');
        if (variant) indicator.setAttribute('data-variant', variant);
        else indicator.removeAttribute('data-variant');
      }

      target = measureItem(el, root);

      if (!hasAppeared) {
        hasAppeared = true;
        indicator.style.transition = 'none';
        layOut();
        if (mounting) indicator.style.opacity = '1';
        void indicator.offsetHeight;
        indicator.style.transition = INDICATOR_TRANSITION;
        indicator.style.opacity = '1';
        return;
      }
      if (laidOut.width && laidOut.height) applyTransform();
      else snap(layOut);
    };

    const settle = (event: TransitionEvent) => {
      if (event.target !== indicator || event.propertyName !== 'transform') return;
      if (laidOut.width === target.width && laidOut.height === target.height) return;
      snap(layOut);
    };

    update();
    mounting = false;
    const observer = new MutationObserver(update);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [attribute],
    });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(root);
    indicator.addEventListener('transitionend', settle);

    let releasing: (() => void) | null = null;

    const release = () => {
      snap(() => indicator.style.removeProperty('--hl-press-scale'));
      releasing?.();
      releasing = null;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const item = event.target.closest<HTMLElement>(selector);
      if (!item || !root.contains(item)) return;
      const styles = getComputedStyle(root);
      const insetX = Number.parseFloat(styles.getPropertyValue('--press-inset-x')) || PRESS_INSET.x;
      const insetY = Number.parseFloat(styles.getPropertyValue('--press-inset-y')) || PRESS_INSET.y;
      const scaleX = target.width ? 1 - (2 * insetX) / target.width : 1;
      const scaleY = target.height ? 1 - (2 * insetY) / target.height : 1;
      snap(() => indicator.style.setProperty('--hl-press-scale', `${scaleX}, ${scaleY}`));
      releasing?.();
      const doc = root.ownerDocument;
      doc.addEventListener('pointerup', release, true);
      doc.addEventListener('pointercancel', release, true);
      releasing = () => {
        doc.removeEventListener('pointerup', release, true);
        doc.removeEventListener('pointercancel', release, true);
      };
    };

    if (press) root.addEventListener('pointerdown', onPointerDown);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      indicator.removeEventListener('transitionend', settle);
      root.removeEventListener('pointerdown', onPointerDown);
      release();
      park();
    };
  }, [rootRef, attribute, value, press, parkWhenEmpty]);

  return indicatorRef;
}
