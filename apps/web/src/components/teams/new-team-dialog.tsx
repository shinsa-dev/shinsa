import { TEAM_NAME_LIMIT } from '@shinsa/core';
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
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@shinsa/ui/components/field';
import { Input } from '@shinsa/ui/components/input';
import type { DialogControl } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import {
  createTeamDraft,
  type ProjectChoice,
  type TeamDraft,
  validateTeamDraft,
} from '@/lib/teams/settings.ts';
import { ProjectsSelect } from './projects-select.tsx';

export function NewTeamDialog<Result>({
  control,
  projects,
  onSubmit,
  onDone,
}: {
  control: DialogControl;
  projects: readonly ProjectChoice[];
  onSubmit: (draft: TeamDraft) => Promise<Result>;
  onDone: (result: Result) => void;
}) {
  const [draft, setDraft] = React.useState(createTeamDraft);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const nameId = React.useId();

  async function submit() {
    const problem = validateTeamDraft(draft);
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
    onDone(result);
  }

  function edit(next: TeamDraft) {
    setDraft(next);
    setError(null);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New team</DialogTitle>
          <DialogDescription>
            Make a team you own. You get a link to share, and you accept or decline each teammate who asks to
            join.
          </DialogDescription>
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
            <Field>
              <FieldTitle>Shared projects</FieldTitle>
              <ProjectsSelect
                label='Shared projects'
                projects={projects}
                chosen={draft.projectIds}
                variant='default'
                className='w-full max-w-none'
                onChange={(projectIds) => edit({ ...draft, projectIds })}
              />
            </Field>
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button type='submit' form={formId} loading={busy}>
            Make team
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
