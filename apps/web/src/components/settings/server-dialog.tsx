import type { McpServerInput, McpServerSummary, McpTransport, PluginSummary } from '@shinsa/core';
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
  createServerDraft,
  type ExtensionPlaces,
  hasSavedSecrets,
  isMultilineField,
  listDraftFields,
  listScopeItems,
  parseScope,
  resolveFieldNote,
  resolveServerDialog,
  SERVER_FIELD,
  type ServerDialogMode,
  type ServerDraft,
  type ServerField,
  TRANSPORT_ITEMS,
  validateServerDraft,
} from '@/lib/extensions.ts';

function DraftField({
  field,
  value,
  error,
  note,
  autoFocus,
  onChange,
}: {
  field: ServerField;
  value: string;
  error: string | undefined;
  note: string | null;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  const { label, placeholder } = SERVER_FIELD[field];
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
      {isMultilineField(field) ? (
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

export function ServerDialog({
  control,
  mode,
  server,
  plugins,
  places,
  onSave,
}: {
  control: DialogControl;
  mode: ServerDialogMode;
  server: McpServerSummary | null;
  plugins: PluginSummary[];
  places: ExtensionPlaces;
  onSave: (input: McpServerInput, done: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState<ServerDraft>(() => createServerDraft(server));
  const [errors, setErrors] = React.useState<Partial<Record<ServerField, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const copy = useHeldValue(resolveServerDialog(mode, server, plugins, draft.name.trim()), control.open);
  const secrets = hasSavedSecrets(server);
  const fields = listDraftFields(draft.transport);

  const change = (patch: Partial<ServerDraft>, field?: ServerField) => {
    setDraft((current) => ({ ...current, ...patch }));
    if (field) setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function save() {
    const checked = validateServerDraft(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    if (await onSave(checked.input, resolveServerDialog(mode, server, plugins, checked.input.name).done)) {
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
            <Field>
              <FieldLabel>How Shinsa reaches it</FieldLabel>
              <SelectField<McpTransport>
                label='How Shinsa reaches it'
                items={TRANSPORT_ITEMS}
                value={draft.transport}
                align='start'
                onValueChange={(transport) => change({ transport })}
              />
            </Field>
            {fields.map((field, index) => (
              <DraftField
                key={field}
                field={field}
                value={draft[field]}
                error={errors[field]}
                note={resolveFieldNote(field, secrets)}
                autoFocus={index === 0 && mode === 'add'}
                onChange={(value) => change({ [field]: value }, field)}
              />
            ))}
            <Field>
              <FieldLabel>Where agents use it</FieldLabel>
              <SelectField
                label='Where agents use it'
                items={listScopeItems(places, parseScope(draft.scope))}
                value={draft.scope}
                align='start'
                onValueChange={(scope) => change({ scope })}
              />
            </Field>
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
