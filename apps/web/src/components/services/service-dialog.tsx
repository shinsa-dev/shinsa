import type { Project, ServiceSuggestion, TerminalPlace } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Card } from '@shinsa/ui/components/card';
import { Checkbox } from '@shinsa/ui/components/checkbox';
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
import { HoverHighlight } from '@shinsa/ui/components/highlight-list';
import { Input } from '@shinsa/ui/components/input';
import { Textarea } from '@shinsa/ui/components/textarea';
import { type DialogControl, useHeldValue } from '@shinsa/ui/hooks/use-dialog-state';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { LIST_ROW, LIST_ROW_LINES, LIST_ROW_META, LIST_ROW_TITLE } from '@/components/layout/list-row.tsx';
import { ICON_SLOT } from '@/components/layout/surface/card.ts';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { requestServiceSuggestions } from '@/lib/connection/terminals.ts';
import {
  createServiceDraft,
  describeAddServices,
  describeNoSuggestions,
  describeServiceFolder,
  listPickedInputs,
  listRecommendedPicks,
  listServiceFolders,
  resolveServiceDialog,
  resolveSuggestionKey,
  SERVICE_FIELDS,
  type ServiceDraft,
  type ServiceField,
  type ServiceFolder,
  type ServiceInput,
  togglePick,
  validateServiceDraft,
} from '@/lib/terminal/services.ts';

const DRAFT_FIELDS: ServiceField[] = ['name', 'path', 'command', 'env'];

type DraftErrors = Partial<Record<ServiceField, string>>;

function DraftField({
  field,
  value,
  error,
  folders,
  autoFocus,
  onChange,
}: {
  field: ServiceField;
  value: string;
  error: string | undefined;
  folders: ServiceFolder[];
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
      {(field === 'name' || field === 'command') && (
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

function ServiceFields({
  draft,
  errors,
  folders,
  autoFocus,
  onChange,
}: {
  draft: ServiceDraft;
  errors: DraftErrors;
  folders: ServiceFolder[];
  autoFocus: boolean;
  onChange: (field: ServiceField, value: string) => void;
}) {
  return (
    <FieldGroup>
      {DRAFT_FIELDS.map((field, index) => (
        <DraftField
          key={field}
          field={field}
          value={draft[field]}
          error={errors[field]}
          folders={folders}
          autoFocus={autoFocus && index === 0}
          onChange={(value) => onChange(field, value)}
        />
      ))}
    </FieldGroup>
  );
}

function useDraft(initial: ServiceDraft) {
  const [draft, setDraft] = React.useState(initial);
  const [errors, setErrors] = React.useState<DraftErrors>({});
  const change = (field: ServiceField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const check = (shown: ServiceDraft) => {
    const checked = validateServiceDraft(shown);
    setErrors(checked.ok ? {} : checked.errors);
    return checked.ok ? checked.input : null;
  };
  return { draft, errors, change, check };
}

function SuggestionRow({
  suggestion,
  places,
  picked,
  onToggle,
}: {
  suggestion: ServiceSuggestion;
  places: TerminalPlace[];
  picked: boolean;
  onToggle: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole row toggles its checkbox
    <div data-highlight-item='' onClick={onToggle} className={cn(LIST_ROW, LIST_ROW_LINES, 'px-1.5')}>
      <span className={ICON_SLOT}>
        <Checkbox
          size='sm'
          checked={picked}
          aria-label={`Add ${suggestion.name}`}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={onToggle}
        />
      </span>
      <span className='flex min-w-0 flex-1 flex-col gap-px'>
        <span className={cn(LIST_ROW_TITLE, 'truncate')}>{suggestion.name}</span>
        <span className={cn(LIST_ROW_META, 'truncate')}>
          <span className='font-mono'>{suggestion.command}</span> in{' '}
          {describeServiceFolder(suggestion.cwd, places)}
        </span>
      </span>
    </div>
  );
}

export function ServicePicker({
  suggestions,
  places,
  picked,
  onToggle,
}: {
  suggestions: ServiceSuggestion[];
  places: TerminalPlace[];
  picked: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <Card role='group' aria-label='Services found' className='gap-0 p-0'>
      <HoverHighlight className='flex flex-col gap-px'>
        {suggestions.map((suggestion) => {
          const key = resolveSuggestionKey(suggestion);
          return (
            <SuggestionRow
              key={key}
              suggestion={suggestion}
              places={places}
              picked={picked.includes(key)}
              onToggle={() => onToggle(key)}
            />
          );
        })}
      </HoverHighlight>
    </Card>
  );
}

function useSuggestions(projectId: string, open: boolean) {
  const [found, setFound] = React.useState<{ projectId: string; suggestions: ServiceSuggestion[] } | null>(
    null
  );
  React.useEffect(() => {
    if (!open) return;
    let current = true;
    const keep = (suggestions: ServiceSuggestion[]) => {
      if (current) setFound({ projectId, suggestions });
    };
    requestServiceSuggestions(projectId).then(keep, () => keep([]));
    return () => {
      current = false;
    };
  }, [projectId, open]);
  return found?.projectId === projectId ? found.suggestions : null;
}

export function AddServicesDialog({
  control,
  projects,
  projectId: initialProject,
  home,
  listPlaces,
  onAdd,
  onAddOne,
}: {
  control: DialogControl;
  projects: Project[];
  projectId: string;
  home: string | null;
  listPlaces: (projectId: string) => TerminalPlace[];
  onAdd: (projectId: string, inputs: ServiceInput[]) => Promise<boolean>;
  onAddOne: (projectId: string, input: ServiceInput) => Promise<boolean>;
}) {
  const [projectId, setProjectId] = React.useState(initialProject);
  const project = projects.find((each) => each.id === projectId);
  const places = listPlaces(projectId);
  const suggestions = useSuggestions(projectId, control.open);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [advanced, setAdvanced] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const folders = listServiceFolders(places, suggestions ?? [], home, null);
  const manual = useDraft(createServiceDraft(null));
  const copy = useHeldValue(resolveServiceDialog('add', ''), control.open);
  const formId = React.useId();
  const none = suggestions?.length === 0;
  const manualOpen = advanced || none;
  const manualDraft = folders.some((folder) => folder.value === manual.draft.path)
    ? manual.draft
    : { ...manual.draft, path: folders[0]?.value ?? '' };

  React.useEffect(() => {
    if (suggestions) setPicked(listRecommendedPicks(suggestions));
  }, [suggestions]);

  async function finish(sent: Promise<boolean>) {
    setBusy(true);
    if (await sent) {
      control.onOpenChange(false);
      return;
    }
    setBusy(false);
  }

  function addPicked() {
    const inputs = listPickedInputs(suggestions ?? [], picked);
    if (inputs.length > 0) void finish(onAdd(projectId, inputs));
  }

  function addManual() {
    const input = manual.check(manualDraft);
    if (input) void finish(onAddOne(projectId, input));
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className='flex w-full flex-col gap-3'>
          {projects.length > 1 && (
            <Field>
              <FieldLabel>Project</FieldLabel>
              <SelectField
                label='Project'
                items={projects.map((each) => ({ value: each.id, label: each.name, dot: each.color }))}
                value={projectId}
                align='start'
                className='w-full'
                onValueChange={setProjectId}
              />
            </Field>
          )}
          {!suggestions && <LoadingLine label='Looking for services' className='h-7 text-xs' />}
          {suggestions && suggestions.length > 0 && (
            <ServicePicker
              suggestions={suggestions}
              places={places}
              picked={picked}
              onToggle={(key) => setPicked((current) => togglePick(current, key))}
            />
          )}
          {none && project && <p className='text-fg-2 text-xs'>{describeNoSuggestions(project.name)}</p>}
          {suggestions && (
            <div className='flex flex-col gap-2'>
              {!none && (
                <DisclosureHeader
                  open={advanced}
                  onToggle={() => setAdvanced((value) => !value)}
                  chevron='glyph'
                  className='h-7 gap-1.5 px-1 text-xs'
                >
                  <span className='font-medium text-fg-3'>Advanced</span>
                </DisclosureHeader>
              )}
              {manualOpen && (
                <form
                  id={formId}
                  className='flex flex-col gap-3'
                  onSubmit={(event) => {
                    event.preventDefault();
                    addManual();
                  }}
                >
                  <ServiceFields
                    draft={manualDraft}
                    errors={manual.errors}
                    folders={folders}
                    autoFocus={advanced}
                    onChange={manual.change}
                  />
                  {!none && (
                    <Button type='submit' variant='secondary' size='sm' className='self-end' loading={busy}>
                      {copy.action}
                    </Button>
                  )}
                </form>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          {none ? (
            <Button type='submit' form={formId} loading={busy}>
              {copy.action}
            </Button>
          ) : (
            <Button disabled={picked.length === 0} loading={busy} onClick={addPicked}>
              {describeAddServices(picked.length)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditServiceDialog({
  control,
  draft: initial,
  places,
  home,
  onSave,
}: {
  control: DialogControl;
  draft: ServiceDraft;
  places: TerminalPlace[];
  home: string | null;
  onSave: (input: ServiceInput, done: string) => Promise<boolean>;
}) {
  const edit = useDraft(initial);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const copy = useHeldValue(resolveServiceDialog('edit', edit.draft.name.trim()), control.open);
  const folders = listServiceFolders(places, [], home, initial.path);

  async function save() {
    const input = edit.check(edit.draft);
    if (!input) return;
    setBusy(true);
    if (await onSave(input, resolveServiceDialog('edit', input.name).done)) {
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
          <ServiceFields
            draft={edit.draft}
            errors={edit.errors}
            folders={folders}
            autoFocus={false}
            onChange={edit.change}
          />
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
