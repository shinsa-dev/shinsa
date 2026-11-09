export interface InitiativePhase {
  id: string;
  name: string;
}

export interface Initiative {
  id: string;
  name: string;
  description: string;
  phases: InitiativePhase[];
  leadTaskId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const INITIATIVE_LIMITS = {
  name: 80,
  description: 2_000,
  phases: 12,
  phaseName: 60,
  initiatives: 50,
} as const;

export function resolveInitiativeText(text: string) {
  return text.trim().replace(/\s+/g, ' ');
}

export function selectInitiativePhase(initiative: Initiative, phaseId: string | null | undefined) {
  if (!phaseId) return null;
  return initiative.phases.find((phase) => phase.id === phaseId) ?? null;
}

export function selectInitiativeByReference<T extends Pick<Initiative, 'id' | 'name'>>(
  initiatives: Iterable<T>,
  reference: string
) {
  const trimmed = reference.trim();
  const lower = trimmed.toLowerCase();
  if (!lower) return null;
  const list = [...initiatives];
  return (
    list.find((initiative) => initiative.id === trimmed) ??
    list.find((initiative) => initiative.name.toLowerCase() === lower) ??
    list.find((initiative) => initiative.id.startsWith(trimmed)) ??
    null
  );
}
