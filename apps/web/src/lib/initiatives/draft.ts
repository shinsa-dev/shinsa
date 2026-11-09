import { INITIATIVE_LIMITS, type Initiative, resolveInitiativeText, type UserCommand } from '@shinsa/core';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { createSignal } from '@/lib/signal.ts';

export interface PhaseDraft {
  key: string;
  id: string | null;
  name: string;
}

export interface InitiativeDraft {
  name: string;
  description: string;
  phases: PhaseDraft[];
}

export const NEW_INITIATIVE = {
  title: 'New initiative',
  description: 'Group the tasks of one large piece of work.',
  submit: 'Create initiative',
} as const;

export const EDIT_INITIATIVE = {
  title: 'Edit initiative',
  description: 'Rename it, describe it or change its phases.',
  submit: 'Save',
} as const;

export const PHASES_HINT = 'Phases run in this order. A task keeps its phase when you rename it.';

export interface InitiativeDialogTarget {
  initiativeId: string | null;
}

const dialogSignal = createSignal();

let dialogTarget: InitiativeDialogTarget | null = null;

let phaseKeys = 0;

export function openInitiativeDialog(initiativeId: string | null = null) {
  dialogTarget = { initiativeId };
  dialogSignal.publish();
}

export function closeInitiativeDialog() {
  dialogTarget = null;
  dialogSignal.publish();
}

export function useInitiativeDialog() {
  return useSyncExternalStore(dialogSignal.subscribe, () => dialogTarget);
}

export function createPhaseDraft(name = ''): PhaseDraft {
  phaseKeys += 1;
  return { key: `new-${phaseKeys}`, id: null, name };
}

export function createInitiativeDraft(initiative: Initiative | null): InitiativeDraft {
  if (!initiative) return { name: '', description: '', phases: [] };
  return {
    name: initiative.name,
    description: initiative.description,
    phases: initiative.phases.map((phase) => ({ key: phase.id, id: phase.id, name: phase.name })),
  };
}

export function movePhase(phases: readonly PhaseDraft[], key: string, offset: -1 | 1) {
  const from = phases.findIndex((phase) => phase.key === key);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= phases.length) return [...phases];
  const next = [...phases];
  const [moved] = next.splice(from, 1) as [PhaseDraft];
  next.splice(to, 0, moved);
  return next;
}

export function resolveDraftProblem(draft: InitiativeDraft) {
  const name = resolveInitiativeText(draft.name);
  if (name.length === 0) return 'Name the initiative.';
  if (name.length > INITIATIVE_LIMITS.name) {
    return `A name can be at most ${INITIATIVE_LIMITS.name} characters.`;
  }
  if (draft.description.trim().length > INITIATIVE_LIMITS.description) {
    return `A description can be at most ${INITIATIVE_LIMITS.description} characters.`;
  }
  if (draft.phases.length > INITIATIVE_LIMITS.phases) {
    return `An initiative can have at most ${INITIATIVE_LIMITS.phases} phases.`;
  }
  const seen = new Set<string>();
  for (const phase of draft.phases) {
    const phaseName = resolveInitiativeText(phase.name);
    if (phaseName.length === 0) return 'Name every phase, or remove the empty one.';
    if (phaseName.length > INITIATIVE_LIMITS.phaseName) {
      return `A phase's name can be at most ${INITIATIVE_LIMITS.phaseName} characters.`;
    }
    const lower = phaseName.toLowerCase();
    if (seen.has(lower)) return `Two phases are named ${phaseName}. Give each its own name.`;
    seen.add(lower);
  }
  return null;
}

export function serializeInitiativeDraft(
  draft: InitiativeDraft,
  initiative: Initiative | null
): Extract<UserCommand, { type: 'initiative.write' }> {
  return {
    type: 'initiative.write',
    initiativeId: initiative?.id ?? null,
    name: resolveInitiativeText(draft.name),
    description: draft.description.trim(),
    phases: draft.phases.map((phase) => ({ id: phase.id, name: resolveInitiativeText(phase.name) })),
  };
}

export function writeInitiative(draft: InitiativeDraft, initiative: Initiative | null) {
  const command = serializeInitiativeDraft(draft, initiative);
  return sendCommandWithToast(
    command,
    initiative ? `Saved the initiative “${command.name}”.` : `Created the initiative “${command.name}”.`
  );
}
