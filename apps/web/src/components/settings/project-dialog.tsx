import type { Project, ProjectInput, ShinsaState } from '@shinsa/core';
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
import { Textarea } from '@shinsa/ui/components/textarea';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import {
  createProjectDraft,
  KEY_RULE,
  OPTIONAL_KEY_PLACEHOLDER,
  PROJECT_DIALOG,
  PROJECT_FIELD,
  type ProjectDialogMode,
  type ProjectDraft,
  type ProjectField,
  resolveDraftInput,
  validateProjectDraft,
} from '@/lib/projects.ts';

function DraftField({
  field,
  mode,
  draft,
  error,
  onChange,
}: {
  field: ProjectField;
  mode: ProjectDialogMode;
  draft: ProjectDraft;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  const { label, placeholder } = PROJECT_FIELD[field];
  const common = {
    id,
    value: draft[field],
    'aria-invalid': error ? true : undefined,
    autoFocus: PROJECT_DIALOG[mode].fields[0] === field,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {field === 'description' ? (
        <Textarea
          {...common}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
      ) : (
        <Input
          {...common}
          placeholder={field === 'key' && mode === 'create' ? OPTIONAL_KEY_PLACEHOLDER : placeholder}
          className={field === 'key' ? 'font-mono uppercase' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field === 'key' && !error && <FieldDescription>{KEY_RULE}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function ProjectDialog({
  control,
  state,
  mode,
  project,
  onSave,
}: {
  control: DialogControl;
  state: ShinsaState;
  mode: ProjectDialogMode;
  project: Project | null;
  onSave: (input: ProjectInput, done: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = React.useState(() => createProjectDraft(project));
  const [errors, setErrors] = React.useState<Partial<Record<ProjectField, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const formId = React.useId();
  const copy = PROJECT_DIALOG[mode];

  async function save() {
    const checked = validateProjectDraft(state, mode, draft, project?.id ?? null);
    setErrors(checked.errors);
    if (!checked.ok) return;
    setBusy(true);
    const refused = await onSave(resolveDraftInput(state, draft, project), copy.done);
    if (!refused) {
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
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
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
            {copy.fields.map((field) => (
              <DraftField
                key={field}
                field={field}
                mode={mode}
                draft={draft}
                error={errors[field]}
                onChange={(value) => {
                  setDraft((current) => ({ ...current, [field]: value }));
                  setErrors((current) => ({ ...current, [field]: undefined }));
                  setRefusal(null);
                }}
              />
            ))}
            {refusal && <FieldError>{refusal}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} loading={busy}>
            {copy.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
