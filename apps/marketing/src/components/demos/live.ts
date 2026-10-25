import * as React from 'react';

function markLive(root: HTMLElement, select: (root: HTMLElement) => Element[]) {
  const live = new Set(select(root));
  for (const element of root.querySelectorAll('[data-live]')) {
    if (!live.has(element)) element.removeAttribute('data-live');
  }
  for (const element of live) {
    if (!element.hasAttribute('data-live')) element.setAttribute('data-live', '');
  }
}

export function useLiveElements<T extends HTMLElement>(select: (root: HTMLElement) => Element[]) {
  const ref = React.useRef<T>(null);
  const latest = React.useRef(select);
  latest.current = select;
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    markLive(root, latest.current);
    const observer = new MutationObserver(() => markLive(root, latest.current));
    observer.observe(root, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, []);
  return ref;
}
