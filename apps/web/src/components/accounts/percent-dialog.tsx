import type { AccountSummary } from '@shinsa/core';
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
import { type DialogControl, useHeldValue } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { ACCOUNT_LABEL } from '@/lib/accounts/account.ts';
import { describePercentChoice, PERCENT_HINT, PERCENT_TITLE, parsePercent } from '@/lib/accounts/limits.ts';

export function PercentDialog({
  control,
  account,
  initial,
  onSave,
}: {
  control: DialogControl;
  account: AccountSummary | null;
  initial: number | null;
  onSave: (percent: number) => Promise<boolean>;
}) {
  const [text, setText] = React.useState(initial === null ? '' : String(initial));
  const [invalid, setInvalid] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const description = useHeldValue(describePercentChoice(account), control.open);

  async function save() {
    const percent = parsePercent(text);
    setInvalid(percent === null);
    if (percent === null) return;
    setBusy(true);
    if (await onSave(percent)) {
      control.onOpenChange(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{PERCENT_TITLE}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
              aria-label={ACCOUNT_LABEL.percentage}
              aria-invalid={invalid || undefined}
              placeholder={ACCOUNT_LABEL.percentageExample}
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
            />
            {invalid && <FieldError>{PERCENT_HINT}</FieldError>}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} disabled={!text.trim()} loading={busy}>
            {ACCOUNT_LABEL.savePercentage}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
