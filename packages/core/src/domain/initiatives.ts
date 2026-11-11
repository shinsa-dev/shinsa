export interface InitiativePhase {
  id: string;
  name: string;
}

export type InitiativeMilestoneKind =
  | 'joined'
  | 'plan_approved'
  | 'gate_opened'
  | 'merged'
  | 'done'
  | 'cancelled';

export interface InitiativeMilestone {
  taskId: string;
  kind: InitiativeMilestoneKind;
  text: string;
  at: number;
}

export interface InitiativeReport {
  narrative: string;
  runId: string;
  at: number;
}

export interface Initiative {
  id: string;
  name: string;
  description: string;
  phases: InitiativePhase[];
  leadTaskId: string | null;
  createdAt: number;
  updatedAt: number;
  milestones?: InitiativeMilestone[];
  report?: InitiativeReport | null;
  teamIds?: string[];
}

export const INITIATIVE_LIMITS = {
  name: 80,
  description: 2_000,
  phases: 12,
  phaseName: 60,
  initiatives: 50,
  milestones: 40,
  narrative: 2_000,
} as const;

export function selectLeadInitiative<T extends Pick<Initiative, 'leadTaskId'>>(
  initiatives: Iterable<T>,
  taskId: string
) {
  for (const initiative of initiatives) if (initiative.leadTaskId === taskId) return initiative;
  return null;
}

export function isInitiativeInTeam(initiative: Pick<Initiative, 'teamIds'>, teamId: string) {
  return (initiative.teamIds ?? []).includes(teamId);
}

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
