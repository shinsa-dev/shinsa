import * as React from 'react';
import { type ReviewStep, resolveReviewKey } from '@/lib/review/keys.ts';

export function useReviewKeys(onStep: (step: ReviewStep) => void) {
  const latest = React.useRef(onStep);
  latest.current = onStep;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = resolveReviewKey(event);
      if (!step) return;
      event.preventDefault();
      latest.current(step);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
