import type { Settings } from '../domain/settings.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';

export interface PlacementMachine {
  id: string;
  name: string;
  state: {
    tasks: Record<string, Pick<Task, 'stage'>>;
    projects: Record<string, unknown>;
    settings: Pick<Settings, 'taskCapacity' | 'placementPolicies'>;
  };
}

export const PLACEMENT_POLICY_LIMITS = { text: 240, perMachine: 20 } as const;

export function isPlacementPoliciesValid(policies: readonly string[]) {
  return (
    policies.length <= PLACEMENT_POLICY_LIMITS.perMachine &&
    policies.every(
      (policy) => policy.trim().length > 0 && policy.trim().length <= PLACEMENT_POLICY_LIMITS.text
    )
  );
}

export function listPolicyTerms(policy: string) {
  return policy
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

function escapePattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesTerm(request: string, term: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapePattern(term)}($|[^\\p{L}\\p{N}])`, 'iu').test(request);
}

export function resolvePolicyMachine(machines: PlacementMachine[], request: string) {
  for (const machine of machines)
    for (const policy of machine.state.settings.placementPolicies ?? []) {
      const term = listPolicyTerms(policy).find((candidate) => matchesTerm(request, candidate));
      if (term) return { id: machine.id, policy, term };
    }
  return null;
}

export interface MachineLoad {
  id: string;
  name: string;
  open: number;
  capacity: number | null;
  full: boolean;
}

export function resolveMachineLoad(machine: PlacementMachine): MachineLoad {
  const open = Object.values(machine.state.tasks).filter((task) => !isTaskSettled(task)).length;
  const capacity = machine.state.settings.taskCapacity ?? null;
  return { id: machine.id, name: machine.name, open, capacity, full: capacity !== null && open >= capacity };
}

function resolveLoadShare(load: MachineLoad) {
  return load.capacity === null ? 0 : load.open / load.capacity;
}

function compareLoads(left: MachineLoad, right: MachineLoad) {
  return resolveLoadShare(left) - resolveLoadShare(right) || left.open - right.open;
}

export function resolveProjectMachine(machines: PlacementMachine[], projectId: string) {
  return machines.find((machine) => projectId in machine.state.projects)?.id ?? null;
}

export function resolvePlacement(machines: PlacementMachine[], projectId: string | null, request = '') {
  const owner = projectId ? resolveProjectMachine(machines, projectId) : null;
  if (owner) return owner;
  const ruled = resolvePolicyMachine(machines, request);
  if (ruled) return ruled.id;
  const loads = machines.map(resolveMachineLoad);
  const roomy = loads.filter((load) => !load.full);
  const [best] = (roomy.length > 0 ? roomy : loads).sort(compareLoads);
  return best?.id ?? null;
}
