import type { Initiative } from '../domain/initiatives.ts';

export type InitiativeEventBody =
  | { type: 'initiative.written'; initiative: Initiative }
  | { type: 'initiative.removed'; initiativeId: string }
  | { type: 'task.initiative_changed'; taskId: string; initiativeId: string | null; phaseId: string | null };
