import * as React from 'react';
import { useOnHide } from '@/hooks/use-on-hide.ts';
import {
  hasScrollAnchoring,
  resolveGrownStart,
  resolveInitialStart,
  resolveScrollShift,
  resolveShownStart,
  shouldFill,
  shouldGrow,
} from '@/lib/chat/window.ts';

interface Anchor {
  element: Element;
  offset: number;
}

function resolveOffset(element: Element, content: Element) {
  return element.getBoundingClientRect().top - content.getBoundingClientRect().top;
}

export function useTranscriptWindow({
  count,
  focusIndex,
  scroller,
  content,
}: {
  count: number;
  focusIndex: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  content: React.RefObject<HTMLDivElement | null>;
}) {
  const [start, setStart] = React.useState(() => resolveInitialStart(count));
  const shown = resolveShownStart(start, count, focusIndex);
  const anchor = React.useRef<Anchor | null>(null);
  const growing = React.useRef(false);

  useOnHide(() => {
    anchor.current = null;
    growing.current = false;
    setStart(resolveInitialStart(count));
  });

  const grow = React.useCallback(() => {
    const inner = content.current;
    const first = inner?.firstElementChild;
    if (growing.current || !inner || !first) return;
    growing.current = true;
    anchor.current = { element: first, offset: resolveOffset(first, inner) };
    React.startTransition(() => setStart((current) => resolveGrownStart(Math.min(current, shown))));
  }, [content, shown]);

  React.useLayoutEffect(() => {
    if (shown < start) setStart(shown);
  }, [shown, start]);

  React.useLayoutEffect(() => {
    const viewport = scroller.current;
    const inner = content.current;
    const held = anchor.current;
    anchor.current = null;
    growing.current = false;
    if (!viewport || !inner) return;
    if (held?.element.isConnected) {
      const shift = resolveOffset(held.element, inner) - held.offset;
      viewport.scrollTop += resolveScrollShift(shift, viewport.scrollTop, hasScrollAnchoring());
    }
    if (shouldFill(shown, inner.offsetHeight, viewport.clientHeight)) {
      setStart(resolveGrownStart(shown));
    } else if (held && shouldGrow(shown, viewport.scrollTop, viewport.clientHeight)) {
      requestAnimationFrame(grow);
    }
  }, [shown, scroller, content, grow]);

  React.useEffect(() => {
    const viewport = scroller.current;
    if (!viewport) return;
    const onScroll = () => {
      if (shouldGrow(shown, viewport.scrollTop, viewport.clientHeight)) grow();
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [scroller, shown, grow]);

  return shown;
}
