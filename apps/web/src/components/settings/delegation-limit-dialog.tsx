import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Field, FieldError } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { DELEGATION_LIMIT_HINT, DELEGATION_LIMIT_TITLE, parseDelegationCount } from '@/lib/settings.ts';

export function DelegationLimitDialog({
  control,
  initial,
  onSave,
}: {
  control: DialogControl;
  initial: number | null;
  onSave: (limit: number) => Promise<boolean>;
}) {
  const [text, setText] = React.useState(initial === null ? '' : String(initial));
  const [invalid, setInvalid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();

  async function save() {
    const limit = parseDelegationCount(text);
    setInvalid(limit === null);
    if (limit === null) return;
    setBusy(true);
    if (await onSave(limit)) {
      control.onOpenChange(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{DELEGATION_LIMIT_TITLE}</DialogTitle>
          <DialogDescription>
            How many agents a step may have working for it at once, counting the ones they delegate to.
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field data-invalid={invalid || undefined}>
            <Input
              value={text}
              inputMode='numeric'
              aria-label='Delegations'
              aria-invalid={invalid || undefined}
              placeholder='For example, 6'
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
            />
            {invalid && <FieldError>{DELEGATION_LIMIT_HINT}</FieldError>}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} disabled={!text.trim()} loading={busy}>
            Save limit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
