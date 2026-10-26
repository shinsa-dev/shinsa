import * as React from 'react';

const FOCUS_STEPS = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

function isFocused(entry: IntersectionObserverEntry) {
  const shown = entry.intersectionRect.height;
  return entry.intersectionRatio >= 0.5 || shown >= window.innerHeight * 0.45;
}

export const FIRST_STEP_MS = 300;

export function useFocus<T extends Element>() {
  const ref = React.useRef<T>(null);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setFocused(entry ? isFocused(entry) : false), {
      threshold: FOCUS_STEPS,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, focused };
}
