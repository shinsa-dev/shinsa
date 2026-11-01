import * as React from 'react';
import { isStructurallyEqual } from '@/lib/format/equal.ts';

export function useStructuralValue<T>(value: T): T {
  const kept = React.useRef(value);
  if (!isStructurallyEqual(kept.current, value)) kept.current = value;
  return kept.current;
}
