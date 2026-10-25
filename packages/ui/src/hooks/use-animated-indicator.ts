import * as React from 'react';

export const INDICATOR_TRANSITION =
  'transform 180ms cubic-bezier(0.22, 1, 0.36, 1), width 180ms cubic-bezier(0.22, 1, 0.36, 1), height 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 120ms ease-out';

const PRESS_INSET = { x: 1, y: 0.5 };

/**
 * Attaches a sliding indicator to any container whose items expose a
 * boolean-ish attribute (e.g. `data-highlighted`, `data-active`). Pure
 * imperative DOM — no React re-renders on hover/active change.
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
    slide = true,
  }: { attribute?: string; value?: string; press?: boolean; parkWhenEmpty?: boolean; slide?: boolean } = {}
): React.RefObject<HTMLDivElement | null> {
  const indicatorRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = rootRef.current;
    const indicator = indicatorRef.current;
    if (!root || !indicator) return;

    let hasAppeared = false;
    let translate = '';
    let activeEl: HTMLElement | null = null;
    const selector = value === undefined ? `[${attribute}]` : `[${attribute}="${value}"]`;

    const applyTransform = () => {
      indicator.style.transform = `${translate} scale(var(--hl-press-scale, 1))`;
    };

    const park = () => {
      activeEl?.removeAttribute('data-indicator-here');
      activeEl = null;
      hasAppeared = false;
      translate = '';
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

      // Walk the offsetParent chain up to `root` for the item's position in
      // layout coords. offset* instead of getBoundingClientRect avoids
      // measurement drift during the popup's open/close transforms
      // (zoom-in-95 etc.), which would otherwise land the indicator mid-item.
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
      translate = `translate(${left}px, ${top}px)`;

      if (!hasAppeared) {
        hasAppeared = true;
        indicator.style.transition = 'none';
        applyTransform();
        indicator.style.width = `${el.offsetWidth}px`;
        indicator.style.height = `${el.offsetHeight}px`;
        void indicator.offsetHeight;
        indicator.style.transition = slide ? INDICATOR_TRANSITION : 'none';
        indicator.style.opacity = '1';
        return;
      }
      applyTransform();
      indicator.style.width = `${el.offsetWidth}px`;
      indicator.style.height = `${el.offsetHeight}px`;
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [attribute],
    });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(root);

    let releasing: (() => void) | null = null;

    const snap = (change: () => void) => {
      const transition = indicator.style.transition;
      indicator.style.transition = 'none';
      change();
      void indicator.offsetWidth;
      indicator.style.transition = transition;
    };

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
      const width = indicator.offsetWidth;
      const height = indicator.offsetHeight;
      const scaleX = width ? 1 - (2 * insetX) / width : 1;
      const scaleY = height ? 1 - (2 * insetY) / height : 1;
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
      root.removeEventListener('pointerdown', onPointerDown);
      release();
      activeEl?.removeAttribute('data-indicator-here');
    };
  }, [rootRef, attribute, value, press, parkWhenEmpty, slide]);

  return indicatorRef;
}
