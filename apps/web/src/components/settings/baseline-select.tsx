import type { Repo } from '@shinsa/core';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@shinsa/ui/components/field';
import { Textarea } from '@shinsa/ui/components/textarea';
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import {
  BASELINE_DIALOG,
  BASELINE_TITLE,
  type BaselineMode,
  listBaselineItems,
  parseBaselineCommands,
  resolveBaselineMode,
  validateBaselineCommands,
} from '@/lib/baseline.ts';

type BaselineChange = (repo: Repo, commands: string[]) => Promise<boolean>;

function BaselineDialog({
  control,
  repo,
  onSave,
}: {
  control: DialogControl;
  repo: Repo;
  onSave: BaselineChange;
}) {
  const [text, setText] = React.useState(() => repo.checkCommands.join('\n'));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const fieldId = React.useId();

  async function save() {
    const commands = parseBaselineCommands(text);
    const problem = validateBaselineCommands(commands);
    setError(problem);
    if (problem) return;
    setBusy(true);
    const saved = await onSave(repo, commands);
    setBusy(false);
    if (saved) control.onOpenChange(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{BASELINE_DIALOG.title}</DialogTitle>
          <DialogDescription>{BASELINE_DIALOG.description}</DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={fieldId}>{BASELINE_DIALOG.label}</FieldLabel>
            <Textarea
              id={fieldId}
              autoFocus
              value={text}
              rows={4}
              placeholder={BASELINE_DIALOG.placeholder}
              className='font-mono'
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
            />
            {error ? (
              <FieldError>{error}</FieldError>
            ) : (
              <FieldDescription>{BASELINE_DIALOG.hint}</FieldDescription>
            )}
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} loading={busy}>
            {BASELINE_DIALOG.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BaselineSelect({ repo, onChange }: { repo: Repo; onChange: BaselineChange }) {
  const dialog = useDialogState<'edit'>();
  const mode = resolveBaselineMode(repo);
  const editLabel = `Edit the commands that run before review in ${repo.name}`;
  return (
    <>
      <SelectField<BaselineMode>
        label={`${BASELINE_TITLE} in ${repo.name}`}
        size='sm'
        variant='ghost'
        items={listBaselineItems(repo)}
        value={mode}
        onValueChange={(next) => {
          if (next === 'commands') dialog.show('edit');
          else void onChange(repo, []);
        }}
      />
      {mode === 'commands' && (
        <Hint label={editLabel}>
          <Button
            variant='secondary'
            size='icon-sm'
            icon='IconPencil'
            aria-label={editLabel}
            onClick={() => dialog.show('edit')}
          />
        </Hint>
      )}
      {dialog.value && <BaselineDialog control={dialog.control} repo={repo} onSave={onChange} />}
    </>
  );
}
