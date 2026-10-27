import type { CoverageMode, CoverageSetting, Repo } from '@shinsa/core';
import { resolveRepoCoverage } from '@shinsa/core';
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
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import type { CoverageDetectionMap } from '@/lib/connection/coverage.ts';
import {
  COVERAGE_DIALOG,
  COVERAGE_TITLE,
  type CoverageDraft,
  type CoverageDraftField,
  type CoverageFormatChoice,
  createCoverageDraft,
  listCoverageItems,
  listFormatChoices,
  resolveDraftCoverage,
  validateCoverageDraft,
} from '@/lib/coverage.ts';

type CoverageChange = (repo: Repo, setting: CoverageSetting) => Promise<boolean>;

function TextField({
  field,
  draft,
  error,
  autoFocus,
  onChange,
}: {
  field: 'command' | 'report';
  draft: CoverageDraft;
  error: string | undefined;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  const copy = COVERAGE_DIALOG.fields[field];
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{copy.label}</FieldLabel>
      <Input
        id={id}
        value={draft[field]}
        autoFocus={autoFocus}
        placeholder={copy.placeholder}
        className='font-mono'
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {'hint' in copy && !error && <FieldDescription>{copy.hint}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

function CoverageDialog({
  control,
  repo,
  onSave,
}: {
  control: DialogControl;
  repo: Repo;
  onSave: CoverageChange;
}) {
  const [draft, setDraft] = React.useState(() => createCoverageDraft(repo));
  const [errors, setErrors] = React.useState<Partial<Record<CoverageDraftField, string>>>({});
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();

  function change(field: CoverageDraftField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({
      ...current,
      [field]: undefined,
      ...(field === 'report' ? { format: undefined } : {}),
    }));
  }

  async function save() {
    const checked = validateCoverageDraft(draft);
    setErrors(checked.errors);
    if (!checked.ok) return;
    setBusy(true);
    const saved = await onSave(repo, resolveDraftCoverage(draft));
    setBusy(false);
    if (saved) control.onOpenChange(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{COVERAGE_DIALOG.title}</DialogTitle>
          <DialogDescription>{COVERAGE_DIALOG.description}</DialogDescription>
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
            <TextField
              field='command'
              draft={draft}
              error={errors.command}
              autoFocus
              onChange={(value) => change('command', value)}
            />
            <TextField
              field='report'
              draft={draft}
              error={errors.report}
              onChange={(value) => change('report', value)}
            />
            <Field data-invalid={errors.format ? true : undefined}>
              <FieldLabel>{COVERAGE_DIALOG.fields.format.label}</FieldLabel>
              <SelectField<CoverageFormatChoice>
                label={COVERAGE_DIALOG.fields.format.label}
                align='start'
                items={listFormatChoices(draft.report)}
                value={draft.format}
                onValueChange={(value) => change('format', value)}
              />
              {errors.format && <FieldError>{errors.format}</FieldError>}
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} loading={busy}>
            {COVERAGE_DIALOG.action}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CoverageSelect({
  repo,
  detected,
  onChange,
}: {
  repo: Repo;
  detected: CoverageDetectionMap | null;
  onChange: CoverageChange;
}) {
  const dialog = useDialogState<'custom'>();
  const mode = resolveRepoCoverage(repo).mode;
  const editLabel = `Edit the coverage command for ${repo.name}`;
  return (
    <>
      <SelectField<CoverageMode>
        label={`${COVERAGE_TITLE} in ${repo.name}`}
        size='sm'
        variant='ghost'
        items={listCoverageItems(repo, detected)}
        value={mode}
        onValueChange={(next) => {
          if (next === 'custom') dialog.show('custom');
          else void onChange(repo, { mode: next });
        }}
      />
      {mode === 'custom' && (
        <Hint label={editLabel}>
          <Button
            variant='secondary'
            size='icon-sm'
            icon='IconPencil'
            aria-label={editLabel}
            onClick={() => dialog.show('custom')}
          />
        </Hint>
      )}
      {dialog.value && <CoverageDialog control={dialog.control} repo={repo} onSave={onChange} />}
    </>
  );
}
