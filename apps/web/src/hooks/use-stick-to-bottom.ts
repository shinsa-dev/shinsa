import * as React from 'react';
import { SPOTLIGHT_FADE_MS, SPOTLIGHT_HOLD_MS } from '@/hooks/use-spotlight.ts';

const NEAR_BOTTOM = 80;

function revealRun(runId: string) {
  const delegation = document.querySelector<HTMLElement>(`[data-delegation="${CSS.escape(runId)}"]`);
  if (delegation) {
    delegation.scrollIntoView({ block: 'start' });
    return delegation;
  }
  const target = document.getElementById(`run-${runId}`);
  const last = [...(target?.querySelectorAll('[data-message]') ?? [])].at(-1) ?? target;
  last?.scrollIntoView({ block: 'center' });
  return target;
}

export function useStickToBottom(focusRunId: string | null) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const pinned = React.useRef(focusRunId === null);
  const lastTop = React.useRef(0);
  const focus = React.useRef<{ runId: string; until: number } | null>(null);
  const [detached, setDetached] = React.useState(false);

  function onScroll() {
    const viewport = scroller.current;
    if (!viewport) return;
    const near = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < NEAR_BOTTOM;
    const movedUp = viewport.scrollTop < lastTop.current - 1;
    lastTop.current = viewport.scrollTop;
    if (near) pinned.current = true;
    else if (movedUp) pinned.current = false;
    setDetached(!near && !pinned.current);
  }

  function jumpToLatest() {
    pinned.current = true;
    focus.current = null;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }

  React.useLayoutEffect(() => {
    const viewport = scroller.current;
    const inner = content.current;
    if (!viewport || !inner) return;
    const observer = new ResizeObserver(() => {
      const held = focus.current;
      if (held && Date.now() < held.until) revealRun(held.runId);
      else if (pinned.current) viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!focusRunId) return;
    pinned.current = false;
    focus.current = { runId: focusRunId, until: Date.now() + SPOTLIGHT_HOLD_MS };
    let clear: ReturnType<typeof setTimeout> | undefined;
    let target: HTMLElement | null = null;
    const frame = requestAnimationFrame(() => {
      target = revealRun(focusRunId);
      target?.setAttribute('data-focused', '');
      clear = setTimeout(
        () => target?.removeAttribute('data-focused'),
        SPOTLIGHT_HOLD_MS + SPOTLIGHT_FADE_MS
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(clear);
      target?.removeAttribute('data-focused');
    };
  }, [focusRunId]);

  return { scroller, content, detached, onScroll, jumpToLatest };
}
