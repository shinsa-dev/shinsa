import type { Settings } from '../domain/settings.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { Task } from '../domain/types.ts';
import {
  describeResourceSummary,
  parseResourceSummary,
  type ResourceSummary,
  resolveResourceHeadroom,
  resolveResourceSummary,
} from './resources.ts';

export interface PlacementMachine {
  id: string;
  name: string;
  state: {
    tasks: Record<string, Pick<Task, 'stage'>>;
    projects: Record<string, unknown>;
    settings: Pick<Settings, 'taskCapacity' | 'placementPolicies'>;
  };
  resources?: ResourceSummary | null;
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

export interface MachineLoad {
  id: string;
  name: string;
  open: number;
  capacity: number | null;
  full: boolean;
  headroom: number | null;
}

export function resolveMachineLoad(machine: PlacementMachine): MachineLoad {
  const open = Object.values(machine.state.tasks).filter((task) => !isTaskSettled(task)).length;
  const capacity = machine.state.settings.taskCapacity ?? null;
  const headroom = machine.resources ? resolveResourceHeadroom(machine.resources) : null;
  return {
    id: machine.id,
    name: machine.name,
    open,
    capacity,
    full: capacity !== null && open >= capacity,
    headroom,
  };
}

function resolveLoadShare(load: MachineLoad) {
  return load.capacity === null ? 0 : load.open / load.capacity;
}

function compareLoads(left: MachineLoad, right: MachineLoad) {
  return resolveLoadShare(left) - resolveLoadShare(right) || left.open - right.open;
}

function compareHeadroom(left: MachineLoad, right: MachineLoad) {
  return (right.headroom ?? 0) - (left.headroom ?? 0) || compareLoads(left, right);
}

export function resolveProjectMachine(machines: PlacementMachine[], projectId: string) {
  return machines.find((machine) => projectId in machine.state.projects)?.id ?? null;
}

export function resolvePlacement(machines: PlacementMachine[], projectId: string | null) {
  const owner = projectId ? resolveProjectMachine(machines, projectId) : null;
  if (owner) return owner;
  const loads = machines.map(resolveMachineLoad);
  const roomy = loads.filter((load) => !load.full);
  const compare = loads.every((load) => load.headroom !== null) ? compareHeadroom : compareLoads;
  const [best] = (roomy.length > 0 ? roomy : loads).sort(compare);
  return best?.id ?? null;
}

export interface PlacementCandidate {
  id: string;
  name: string;
  policies: string[];
  open: number;
  capacity: number | null;
  resources: ResourceSummary | null;
}

export interface PlacementQuestion {
  request: string;
  machines: PlacementCandidate[];
}

export interface PlacementAnswer {
  machineId: string;
  reason: string;
}

export const PLACEMENT_LIMITS = { request: 20_000, machines: 20, reason: 240 } as const;

export const NO_POLICY_MACHINE = 'none';

export function hasPlacementPolicies(machines: PlacementMachine[]) {
  return machines.some((machine) => (machine.state.settings.placementPolicies ?? []).length > 0);
}

export function listPlacementCandidates(machines: PlacementMachine[]): PlacementCandidate[] {
  return machines.map((machine) => {
    const load = resolveMachineLoad(machine);
    return {
      id: machine.id,
      name: machine.name,
      policies: machine.state.settings.placementPolicies ?? [],
      open: load.open,
      capacity: load.capacity,
      resources: machine.resources ? resolveResourceSummary(machine.resources) : null,
    };
  });
}

export const PLACEMENT_SYSTEM = [
  'You choose which machine a new coding task runs on.',
  'Each machine runs its own Shinsa engine. The person wrote policies in plain English saying what runs where.',
  'Read the request and the policies. Pick the machine a policy sends this request to.',
  `If no policy speaks to this request, answer "${NO_POLICY_MACHINE}"; the machine with the most room takes it then.`,
  'When two policies conflict, follow the one that matches the request most closely.',
  'Each machine lists its CPU, memory and disk use when it reports them; use them when a policy speaks of them.',
  'The reason is one short sentence in plain words that names the policy you followed.',
].join(' ');

export const PLACEMENT_SCHEMA = {
  type: 'object',
  properties: {
    machine: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['machine', 'reason'],
  additionalProperties: false,
} as const;

function describeCandidate(candidate: PlacementCandidate) {
  const load =
    candidate.capacity === null
      ? `${candidate.open} open tasks, no limit`
      : `${candidate.open} of ${candidate.capacity} open tasks`;
  const use = candidate.resources
    ? describeResourceSummary(candidate.resources)
    : 'resource use not reported';
  const policies =
    candidate.policies.length > 0
      ? candidate.policies.map((policy) => `  - ${policy}`).join('\n')
      : '  (no policies)';
  return `Machine "${candidate.id}" named ${candidate.name} (${load}; ${use}):\n${policies}`;
}

export function serializePlacementPrompt(question: PlacementQuestion) {
  return [
    'Machines and their policies:',
    ...question.machines.map(describeCandidate),
    '',
    'The request:',
    question.request,
    '',
    `Answer with JSON: {"machine": the machine's id in quotes, or "${NO_POLICY_MACHINE}", "reason": one sentence}.`,
  ].join('\n');
}

export function parsePlacementAnswer(question: PlacementQuestion, value: unknown): PlacementAnswer | null {
  if (typeof value !== 'object' || value === null) return null;
  const { machine, reason } = value as { machine?: unknown; reason?: unknown };
  if (typeof machine !== 'string' || !question.machines.some((candidate) => candidate.id === machine))
    return null;
  const said = typeof reason === 'string' ? reason.trim().slice(0, PLACEMENT_LIMITS.reason) : '';
  return { machineId: machine, reason: said };
}

function readCandidate(value: unknown): PlacementCandidate | null {
  if (typeof value !== 'object' || value === null) return null;
  const { id, name, policies, open, capacity, resources } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !id || typeof name !== 'string') return null;
  if (!Array.isArray(policies) || !policies.every((policy) => typeof policy === 'string')) return null;
  if (!isPlacementPoliciesValid(policies)) return null;
  if (typeof open !== 'number' || !Number.isInteger(open) || open < 0) return null;
  if (capacity !== null && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1))
    return null;
  const reported = resources !== null && resources !== undefined;
  const use = reported ? parseResourceSummary(resources) : null;
  if (reported && !use) return null;
  return { id, name: name.slice(0, 120), policies, open, capacity, resources: use };
}

export function parsePlacementQuestion(value: unknown): PlacementQuestion | null {
  if (typeof value !== 'object' || value === null) return null;
  const { request, machines } = value as Record<string, unknown>;
  if (typeof request !== 'string' || !request.trim() || request.length > PLACEMENT_LIMITS.request)
    return null;
  if (!Array.isArray(machines) || machines.length < 2 || machines.length > PLACEMENT_LIMITS.machines)
    return null;
  const candidates = machines.map(readCandidate);
  if (!candidates.every((candidate): candidate is PlacementCandidate => candidate !== null)) return null;
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) return null;
  return { request, machines: candidates };
}
