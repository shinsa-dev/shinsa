import type { Settings } from '../domain/settings.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';

export interface PlacementMachine {
  id: string;
  name: string;
  state: {
    tasks: Record<string, Pick<Task, 'stage'>>;
    projects: Record<string, unknown>;
    settings: Pick<Settings, 'taskCapacity' | 'placementRules'>;
  };
}

export const PLACEMENT_RULE_LIMITS = { count: 20, length: 40 } as const;

export function isPlacementRulesValid(rules: readonly string[]) {
  return (
    rules.length <= PLACEMENT_RULE_LIMITS.count &&
    rules.every((rule) => rule.trim().length > 0 && rule.length <= PLACEMENT_RULE_LIMITS.length)
  );
}

export function parsePlacementRules(text: string) {
  return [
    ...new Set(
      text
        .split(',')
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0)
    ),
  ];
}

function escapePattern(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesRule(request: string, rule: string) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapePattern(rule.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(
    request
  );
}

export function resolveRuleMachine(machines: PlacementMachine[], request: string) {
  for (const machine of machines) {
    const rule = (machine.state.settings.placementRules ?? []).find((candidate) =>
      matchesRule(request, candidate)
    );
    if (rule) return { id: machine.id, rule };
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
  const ruled = resolveRuleMachine(machines, request);
  if (ruled) return ruled.id;
  const loads = machines.map(resolveMachineLoad);
  const roomy = loads.filter((load) => !load.full);
  const [best] = (roomy.length > 0 ? roomy : loads).sort(compareLoads);
  return best?.id ?? null;
}
