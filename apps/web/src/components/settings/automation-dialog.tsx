import type { ShinsaState } from '@shinsa/core';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { toast } from '@shinsa/ui/components/sonner';
import { Textarea } from '@shinsa/ui/components/textarea';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { ChoiceButton, ChoiceButtons } from '@/components/controls/choice-buttons.tsx';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  AUTOMATION_KINDS,
  AUTOMATION_TEXT_LABEL,
  type AutomationDraft,
  type AutomationField,
  createAutomationDraft,
  describeAutomationSaved,
  listRepoItems,
  listSourceItems,
  NO_SOURCES,
  validateAutomationDraft,
  writeAutomation,
} from '@/lib/automations.ts';

export function AutomationDialog({ control, state }: { control: DialogControl; state: ShinsaState }) {
  const [draft, setDraft] = React.useState(createAutomationDraft);
  const [errors, setErrors] = React.useState<Partial<Record<AutomationField, string>>>({});
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const nameId = React.useId();
  const textId = React.useId();
  const everyId = React.useId();
  const sources = listSourceItems(state);
  const kind = AUTOMATION_KINDS.find((each) => each.kind === draft.kind);

  function change(patch: Partial<AutomationDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
    setRefusal(null);
  }

  async function save() {
    const checked = validateAutomationDraft(draft);
    setErrors(checked);
    if (Object.keys(checked).length > 0) return;
    setBusy(true);
    const refused = await writeAutomation(draft);
    if (!refused) {
      toast.success(describeAutomationSaved(draft));
      control.onOpenChange(false);
      return;
    }
    setBusy(false);
    setRefusal(refused);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New automation</DialogTitle>
          <DialogDescription>{kind?.hint}</DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className='w-full'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <ChoiceButtons>
              {AUTOMATION_KINDS.map((each) => (
                <ChoiceButton
                  key={each.kind}
                  option={{ label: each.label }}
                  pressed={draft.kind === each.kind}
                  onClick={() => change({ kind: each.kind })}
                />
              ))}
            </ChoiceButtons>
            <Field>
              <FieldLabel htmlFor={nameId}>Name</FieldLabel>
              <Input
                id={nameId}
                value={draft.name}
                placeholder='Taken from the first line when left empty'
                onChange={(event) => change({ name: event.target.value })}
              />
            </Field>
            {draft.kind === 'watch' && (
              <Field data-invalid={errors.source ? true : undefined}>
                <FieldLabel>Integration</FieldLabel>
                {sources.length === 0 ? (
                  <FieldDescription>{NO_SOURCES}</FieldDescription>
                ) : (
                  <SelectField
                    label='Integration'
                    items={[{ value: '', label: 'Pick an integration' }, ...sources]}
                    value={draft.source}
                    onValueChange={(source) => change({ source })}
                    align='start'
                    className='w-full'
                  />
                )}
                {errors.source && <FieldError>{errors.source}</FieldError>}
              </Field>
            )}
            {draft.kind !== 'watch' && (
              <Field>
                <FieldLabel>Repository</FieldLabel>
                <SelectField
                  label='Repository'
                  items={listRepoItems(state)}
                  value={draft.repoId}
                  onValueChange={(repoId) => change({ repoId })}
                  align='start'
                  className='w-full'
                />
              </Field>
            )}
            {draft.kind !== 'trigger' && (
              <Field data-invalid={errors.everyMinutes ? true : undefined}>
                <FieldLabel htmlFor={everyId}>Every how many minutes</FieldLabel>
                <Input
                  id={everyId}
                  inputMode='numeric'
                  value={draft.everyMinutes}
                  aria-invalid={errors.everyMinutes ? true : undefined}
                  onChange={(event) => change({ everyMinutes: event.target.value })}
                />
                {errors.everyMinutes && <FieldError>{errors.everyMinutes}</FieldError>}
              </Field>
            )}
            <Field data-invalid={errors.text ? true : undefined}>
              <FieldLabel htmlFor={textId}>{AUTOMATION_TEXT_LABEL[draft.kind]}</FieldLabel>
              <Textarea
                id={textId}
                rows={3}
                value={draft.text}
                aria-invalid={errors.text ? true : undefined}
                onChange={(event) => change({ text: event.target.value })}
              />
              {errors.text && <FieldError>{errors.text}</FieldError>}
            </Field>
            {refusal && <FieldError>{refusal}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} loading={busy}>
            Create automation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
