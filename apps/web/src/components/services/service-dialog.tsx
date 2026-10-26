import type { Project } from '@shinsa/core';
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
import { type DialogControl, useHeldValue } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import {
  resolveServiceDialog,
  SERVICE_FIELDS,
  type ServiceDialogMode,
  type ServiceDraft,
  type ServiceField,
  type ServiceInput,
  validateServiceDraft,
} from '@/lib/terminal/services.ts';

const DRAFT_FIELDS: ServiceField[] = ['name', 'path', 'command', 'env'];

function DraftField({
  field,
  value,
  error,
  autoFocus,
  onChange,
}: {
  field: ServiceField;
  value: string;
  error: string | undefined;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  const { label, placeholder, note } = SERVICE_FIELDS[field];
  const common = {
    id,
    value,
    placeholder,
    autoFocus,
    spellCheck: false,
    'aria-invalid': error ? true : undefined,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {field === 'env' ? (
        <Textarea
          {...common}
          rows={3}
          className='font-mono'
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          {...common}
          className={field === 'name' ? undefined : 'font-mono'}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {note && !error && <FieldDescription>{note}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function ServiceDialog({
  control,
  mode,
  draft: initial,
  projects,
  projectId: initialProject,
  onSave,
}: {
  control: DialogControl;
  mode: ServiceDialogMode;
  draft: ServiceDraft;
  projects: Project[];
  projectId: string;
  onSave: (projectId: string, input: ServiceInput, done: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState(initial);
  const [projectId, setProjectId] = React.useState(initialProject);
  const [errors, setErrors] = React.useState<Partial<Record<ServiceField, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const copy = useHeldValue(resolveServiceDialog(mode, draft.name.trim()), control.open);

  const change = (field: ServiceField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save() {
    const checked = validateServiceDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    if (await onSave(projectId, checked.input, resolveServiceDialog(mode, checked.input.name).done)) {
      control.onOpenChange(false);
      return;
    }
    setBusy(false);
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
            {mode === 'add' && projects.length > 1 && (
              <Field>
                <FieldLabel>Project</FieldLabel>
                <SelectField
                  label='Project'
                  items={projects.map((project) => ({ value: project.id, label: project.name }))}
                  value={projectId}
                  align='start'
                  onValueChange={setProjectId}
                />
              </Field>
            )}
            {DRAFT_FIELDS.map((field, index) => (
              <DraftField
                key={field}
                field={field}
                value={draft[field]}
                error={errors[field]}
                autoFocus={index === 0 && mode === 'add' && !draft.name}
                onChange={(value) => change(field, value)}
              />
            ))}
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
