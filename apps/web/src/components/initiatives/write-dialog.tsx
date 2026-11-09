import type { Initiative } from '@shinsa/core';
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
import * as React from 'react';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { useShinsaState } from '@/lib/connection/selectors.ts';
import {
  closeInitiativeDialog,
  createInitiativeDraft,
  createPhaseDraft,
  EDIT_INITIATIVE,
  type InitiativeDraft,
  movePhase,
  NEW_INITIATIVE,
  PHASES_HINT,
  resolveDraftProblem,
  useInitiativeDialog,
  writeInitiative,
} from '@/lib/initiatives/draft.ts';

function PhaseRows({
  draft,
  onChange,
}: {
  draft: InitiativeDraft;
  onChange: (phases: InitiativeDraft['phases']) => void;
}) {
  return (
    <div className='flex flex-col gap-1.5'>
      {draft.phases.map((phase, index) => (
        <div key={phase.key} className='flex items-center gap-1'>
          <span className='w-5 shrink-0 text-right text-xs text-fg-2 tabular-nums'>{index + 1}</span>
          <Input
            value={phase.name}
            aria-label={`Phase ${index + 1}`}
            placeholder='Name the phase'
            className='flex-1'
            onChange={(event) =>
              onChange(
                draft.phases.map((each) =>
                  each.key === phase.key ? { ...each, name: event.target.value } : each
                )
              )
            }
          />
          <HintButton
            label='Move up'
            size='icon-sm'
            icon='IconArrowUp'
            disabled={index === 0}
            onClick={() => onChange(movePhase(draft.phases, phase.key, -1))}
          />
          <HintButton
            label='Move down'
            size='icon-sm'
            icon='IconArrowDown'
            disabled={index === draft.phases.length - 1}
            onClick={() => onChange(movePhase(draft.phases, phase.key, 1))}
          />
          <HintButton
            label='Remove phase'
            size='icon-sm'
            icon='IconCrossMedium'
            onClick={() => onChange(draft.phases.filter((each) => each.key !== phase.key))}
          />
        </div>
      ))}
      <Button
        type='button'
        variant='secondary'
        size='sm'
        icon='IconPlusMedium'
        className='self-start'
        onClick={() => onChange([...draft.phases, createPhaseDraft()])}
      >
        Add phase
      </Button>
    </div>
  );
}

function InitiativeForm({ initiative }: { initiative: Initiative | null }) {
  const [draft, setDraft] = React.useState(() => createInitiativeDraft(initiative));
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const formId = React.useId();
  const nameId = React.useId();
  const descriptionId = React.useId();
  const copy = initiative ? EDIT_INITIATIVE : NEW_INITIATIVE;

  function update(patch: Partial<InitiativeDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setProblem(null);
  }

  async function save() {
    const found = resolveDraftProblem(draft);
    setProblem(found);
    if (found) return;
    setBusy(true);
    const saved = await writeInitiative(draft, initiative);
    setBusy(false);
    if (saved) closeInitiativeDialog();
  }

  return (
    <>
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
            <FieldLabel htmlFor={nameId}>Name</FieldLabel>
            <Input
              id={nameId}
              autoFocus
              value={draft.name}
              placeholder='Name the initiative'
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
            <Textarea
              id={descriptionId}
              rows={3}
              value={draft.description}
              placeholder='What this work is for, and when it is done'
              onChange={(event) => update({ description: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel>Phases</FieldLabel>
            <PhaseRows draft={draft} onChange={(phases) => update({ phases })} />
            <FieldDescription>{PHASES_HINT}</FieldDescription>
          </Field>
          {problem && <FieldError>{problem}</FieldError>}
        </FieldGroup>
      </form>
      <DialogFooter>
        <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
        <Button type='submit' form={formId} loading={busy}>
          {copy.submit}
        </Button>
      </DialogFooter>
    </>
  );
}

export function InitiativeDialog() {
  const target = useInitiativeDialog();
  const state = useShinsaState();
  const initiative = target?.initiativeId ? (state?.initiatives[target.initiativeId] ?? null) : null;
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeInitiativeDialog();
      }}
    >
      <DialogContent>
        {target && <InitiativeForm key={target.initiativeId ?? 'new'} initiative={initiative} />}
      </DialogContent>
    </Dialog>
  );
}
