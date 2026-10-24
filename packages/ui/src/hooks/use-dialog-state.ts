import * as React from 'react';

/** The three props a dialog root takes to open, close and hear that its exit animation ended. */
export interface DialogControl {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChangeComplete: (open: boolean) => void;
}

interface DialogState<Value> {
  value: Value | null;
  open: boolean;
}

const CLOSED: DialogState<never> = { value: null, open: false };

/**
 * A dialog that closes without a visible change. `show(value)` opens it on a
 * value; closing only flips `open`, so `value` (and whatever the dialog renders
 * from it) stays put while the dialog animates out, and is cleared once the exit
 * animation ends. Mount the dialog while `value` is set and spread `control`
 * on its root: it stays mounted through the exit and remounts fresh next time.
 */
export function useDialogState<Value>() {
  const [state, replaceState] = React.useState<DialogState<Value>>(CLOSED);

  const show = React.useCallback((value: Value) => replaceState({ value, open: true }), []);
  const close = React.useCallback(() => replaceState((current) => ({ ...current, open: false })), []);

  const control: DialogControl = {
    open: state.open,
    onOpenChange: (open) => {
      if (!open) close();
    },
    onOpenChangeComplete: (open) => {
      if (!open) replaceState((current) => (current.open ? current : CLOSED));
    },
  };

  return { value: state.value, open: state.open, show, close, control };
}

/**
 * What a dialog shows while it is closing: `value` while `open`, and the value it
 * had when it was last open once it is not, so content that comes from outside
 * the dialog (a store, a server push) cannot change under the exit animation.
 */
export function useHeldValue<Value>(value: Value, open: boolean): Value {
  const held = React.useRef(value);
  if (open) held.current = value;
  return held.current;
}
