import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shinsa/ui/components/alert-dialog';
import { type DialogControl, useHeldValue } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';

export function ConfirmDialog({
  control,
  title,
  body,
  action,
  onConfirm,
}: {
  control: DialogControl;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
}) {
  const confirmed = React.useRef(false);
  const text = useHeldValue({ title, body, action }, control.open);
  return (
    <AlertDialog
      open={control.open}
      onOpenChange={control.onOpenChange}
      onOpenChangeComplete={(open) => {
        control.onOpenChangeComplete(open);
        if (open || !confirmed.current) return;
        confirmed.current = false;
        onConfirm();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            onClick={() => {
              confirmed.current = true;
              control.onOpenChange(false);
            }}
          >
            {text.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
