import * as React from 'react';

const NEAR_MARGIN = '800px';

export function useNearViewport<T extends Element>() {
  const [near, setNear] = React.useState(() => typeof IntersectionObserver === 'undefined');
  const [element, setElement] = React.useState<T | null>(null);
  React.useEffect(() => {
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_MARGIN }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, element]);
  return { near, ref: setElement };
}
