import * as React from 'react';
import { useDelay } from '@/hooks/use-delay.ts';

export function useProgressiveCount(total: number, first: number) {
  const [count, setCount] = React.useState(first);
  useDelay(() => React.startTransition(() => setCount((shown) => shown + first)), count >= total ? null : 0, [
    count,
    first,
  ]);
  return Math.min(total, count);
}
