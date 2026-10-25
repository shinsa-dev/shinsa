import * as React from 'react';

export function useProgressiveCount(total: number, first: number) {
  const [count, setCount] = React.useState(first);
  React.useEffect(() => {
    if (count >= total) return;
    const timer = setTimeout(() => React.startTransition(() => setCount((shown) => shown + first)));
    return () => clearTimeout(timer);
  }, [count, total, first]);
  return Math.min(total, count);
}
