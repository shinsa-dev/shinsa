import { TEAM_NAME_LIMIT } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
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
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import { Label } from '@shinsa/ui/components/label';
import { Truncate } from '@shinsa/ui/components/truncate';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import {
  createTeamDraft,
  type ProjectChoice,
  TEAM_DIALOG,
  type TeamDialogMode,
  type TeamDraft,
  toggleDraftProject,
  validateTeamDraft,
} from '@/lib/teams/settings.ts';

function ProjectOption({
  project,
  picked,
  onToggle,
}: {
  project: ProjectChoice;
  picked: boolean;
  onToggle: (picked: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className='flex min-h-8 items-center gap-2 px-2.5 hover:bg-bg-a1 active:bg-bg-a1'>
      <Checkbox id={id} size='sm' checked={picked} onCheckedChange={onToggle} />
      <Label htmlFor={id} className='min-h-8 min-w-0 flex-1 font-normal text-fg-4'>
        <Truncate>{project.name}</Truncate>
      </Label>
    </div>
  );
}

function ProjectPicker({
  label,
  projects,
  chosen,
  onToggle,
}: {
  label: string;
  projects: readonly ProjectChoice[];
  chosen: readonly string[];
  onToggle: (projectId: string, picked: boolean) => void;
}) {
  return (
    <Field role='group' aria-label={label}>
      <FieldTitle>{label}</FieldTitle>
      {projects.length === 0 ? (
        <p className='text-fg-2 text-xs'>You have no project yet. Add one in Settings → Projects.</p>
      ) : (
        <div className='flex max-h-56 flex-col overflow-y-auto rounded-md border border-border'>
          {projects.map((project) => (
            <ProjectOption
              key={project.id}
              project={project}
              picked={chosen.includes(project.id)}
              onToggle={(picked) => onToggle(project.id, picked)}
            />
          ))}
        </div>
      )}
    </Field>
  );
}

export function TeamDialog<Result>({
  control,
  mode,
  projects,
  initialProjectIds = [],
  onSubmit,
  onDone,
}: {
  control: DialogControl;
  mode: TeamDialogMode;
  projects: readonly ProjectChoice[];
  initialProjectIds?: readonly string[];
  onSubmit: (draft: TeamDraft) => Promise<Result>;
  onDone?: (result: Result) => void;
}) {
  const [draft, setDraft] = React.useState(() => createTeamDraft(initialProjectIds));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const nameId = React.useId();
  const urlId = React.useId();
  const copy = TEAM_DIALOG[mode];

  async function submit() {
    const problem = validateTeamDraft(mode, draft);
    setError(problem);
    if (problem || busy) return;
    setBusy(true);
    let result: Result;
    try {
      result = await onSubmit(draft);
    } catch (failure) {
      setError(describeFailure(failure));
      setBusy(false);
      return;
    }
    setBusy(false);
    control.onOpenChange(false);
    onDone?.(result);
  }

  function edit(next: TeamDraft) {
    setDraft(next);
    setError(null);
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
            void submit();
          }}
        >
          <FieldGroup>
            {mode === 'create' && (
              <Field>
                <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                <Input
                  id={nameId}
                  autoFocus
                  value={draft.name}
                  maxLength={TEAM_NAME_LIMIT}
                  placeholder='Platform'
                  onChange={(event) => edit({ ...draft, name: event.target.value })}
                />
              </Field>
            )}
            {mode === 'join' && (
              <Field>
                <FieldLabel htmlFor={urlId}>Team link</FieldLabel>
                <Input
                  id={urlId}
                  autoFocus
                  value={draft.url}
                  className='font-mono'
                  placeholder='https://app.shinsa.dev/share/team#…'
                  onChange={(event) => edit({ ...draft, url: event.target.value })}
                />
              </Field>
            )}
            <ProjectPicker
              label={copy.projects}
              projects={projects}
              chosen={draft.projectIds}
              onToggle={(projectId, picked) => edit(toggleDraftProject(draft, projectId, picked))}
            />
            {error && <FieldError>{error}</FieldError>}
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
