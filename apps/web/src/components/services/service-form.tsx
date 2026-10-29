import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { Textarea } from '@shinsa/ui/components/textarea';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { createDisclosureId, type Disclosure, useDisclosure } from '@/lib/preferences/disclosure.ts';
import {
  resolveShownErrors,
  SERVICE_FIELDS,
  type ServiceDraft,
  type ServiceErrors,
  type ServiceField,
  type ServiceFolder,
  validateServiceDraft,
} from '@/lib/terminal/services.ts';

const MAIN_FIELDS: ServiceField[] = ['name', 'path', 'command', 'previewUrl'];

const ADVANCED_FIELDS: ServiceField[] = ['portVariable', 'env'];

function DraftField({
  field,
  value,
  error,
  folders,
  autoFocus,
  onChange,
  onLeave,
}: {
  field: ServiceField;
  value: string;
  error: string | undefined;
  folders: ServiceFolder[];
  autoFocus: boolean;
  onChange: (value: string) => void;
  onLeave: () => void;
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
    onBlur: onLeave,
  };
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={field === 'path' ? undefined : id}>{label}</FieldLabel>
      {field === 'path' && (
        <SelectField
          label='Folder'
          items={folders}
          value={value}
          align='start'
          className='w-full'
          onValueChange={onChange}
        />
      )}
      {field === 'env' && (
        <Textarea
          {...common}
          rows={3}
          className='font-mono'
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field !== 'path' && field !== 'env' && (
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

function AdvancedFields({ disclosure, children }: { disclosure: Disclosure; children: React.ReactNode }) {
  return (
    <div className='flex flex-col gap-2'>
      <DisclosureHeader
        disclosure={disclosure}
        label='Advanced'
        strip='line'
        chevron='glyph'
        className='w-fit gap-1 font-medium text-2xs text-fg-2 hover:text-fg-4 active:text-fg-4'
      >
        Advanced
      </DisclosureHeader>
      {disclosure.open && children}
    </div>
  );
}

export function ServiceFields({
  draft,
  errors,
  folders,
  autoFocus,
  onChange,
  onLeave,
}: {
  draft: ServiceDraft;
  errors: ServiceErrors;
  folders: ServiceFolder[];
  autoFocus: boolean;
  onChange: (field: ServiceField, value: string) => void;
  onLeave: (field: ServiceField) => void;
}) {
  const advanced = useDisclosure(
    createDisclosureId('services', 'form', 'advanced'),
    ADVANCED_FIELDS.some((name) => draft[name].trim() !== '')
  );
  const forced = ADVANCED_FIELDS.some((name) => errors[name]) && !advanced.open;
  const field = (name: ServiceField, focus: boolean) => (
    <DraftField
      key={name}
      field={name}
      value={draft[name]}
      error={errors[name]}
      folders={folders}
      autoFocus={focus}
      onChange={(value) => onChange(name, value)}
      onLeave={() => onLeave(name)}
    />
  );
  return (
    <FieldGroup>
      {MAIN_FIELDS.map((name, index) => field(name, autoFocus && index === 0))}
      <AdvancedFields disclosure={forced ? { ...advanced, open: true } : advanced}>
        {ADVANCED_FIELDS.map((name) => field(name, false))}
      </AdvancedFields>
    </FieldGroup>
  );
}

export function useServiceDraft(initial: ServiceDraft) {
  const [draft, setDraft] = React.useState(initial);
  const [changed, setChanged] = React.useState<ServiceField[]>([]);
  const [left, setLeft] = React.useState<ServiceField[]>([]);
  const [submitted, setSubmitted] = React.useState(false);
  const change = (field: ServiceField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setChanged((current) => (current.includes(field) ? current : [...current, field]));
  };
  const leave = (field: ServiceField) => {
    if (changed.includes(field) && !left.includes(field)) setLeft([...left, field]);
  };
  const resolveErrors = (shown: ServiceDraft) => {
    const checked = validateServiceDraft(shown);
    return resolveShownErrors(checked.ok ? {} : checked.errors, left, submitted);
  };
  const check = (shown: ServiceDraft) => {
    setSubmitted(true);
    const checked = validateServiceDraft(shown);
    return checked.ok ? checked.input : null;
  };
  return { draft, change, leave, resolveErrors, check };
}
