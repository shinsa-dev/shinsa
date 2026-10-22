import * as React from 'react';

/**
 * Open state that works both ways: controlled when `open` is passed (the
 * caller owns it and only hears about changes), uncontrolled otherwise
 * (starting from `defaultOpen`). Every change reports through `onOpenChange`.
 */
export function useControllableOpen<Details>({
  open,
  defaultOpen = false,
  onOpenChange,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: Details) => void;
}): [boolean, (open: boolean, details: Details) => void] {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const controlled = open !== undefined;

  const change = React.useCallback(
    (next: boolean, details: Details) => {
      if (!controlled) setUncontrolled(next);
      onOpenChange?.(next, details);
    },
    [controlled, onOpenChange]
  );

  return [controlled ? open : uncontrolled, change];
}
