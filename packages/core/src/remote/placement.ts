import type { Settings } from '../domain/settings.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { Project, Repo, Task } from '../domain/types.ts';
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
    projects: Record<string, Pick<Project, 'name' | 'description'>>;
    repos: Record<string, Pick<Repo, 'name' | 'projectId'>>;
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

export function resolveRoutedPlacement(
  machines: PlacementMachine[],
  answered: string | null,
  fallback: string | null
) {
  const loads = machines.map(resolveMachineLoad);
  const chosen = loads.find((load) => load.id === answered);
  if (!chosen) return fallback;
  return chosen.full && loads.some((load) => !load.full) ? fallback : chosen.id;
}

export interface PlacementProject {
  name: string;
  description: string;
  repositories: string[];
}

const PLACEMENT_PROJECT_LIMITS = {
  perMachine: 50,
  name: 120,
  description: 300,
  repositories: 30,
} as const;

export interface PlacementCandidate {
  id: string;
  name: string;
  policies: string[];
  projects: PlacementProject[];
  repositories: string[];
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

export const NO_PLACEMENT_MACHINE = 'none';

function listRepositoryNames(repos: Pick<Repo, 'name'>[]) {
  return repos
    .map((repo) => repo.name.slice(0, PLACEMENT_PROJECT_LIMITS.name))
    .slice(0, PLACEMENT_PROJECT_LIMITS.repositories);
}

function listMachineProjects(machine: PlacementMachine): PlacementProject[] {
  const repos = Object.values(machine.state.repos);
  return Object.entries(machine.state.projects)
    .slice(0, PLACEMENT_PROJECT_LIMITS.perMachine)
    .map(([id, project]) => ({
      name: project.name.slice(0, PLACEMENT_PROJECT_LIMITS.name),
      description: project.description.slice(0, PLACEMENT_PROJECT_LIMITS.description),
      repositories: listRepositoryNames(repos.filter((repo) => repo.projectId === id)),
    }));
}

function listLooseRepositories(machine: PlacementMachine) {
  return listRepositoryNames(
    Object.values(machine.state.repos).filter(
      (repo) => !repo.projectId || !(repo.projectId in machine.state.projects)
    )
  );
}

export function listPlacementCandidates(machines: PlacementMachine[]): PlacementCandidate[] {
  return machines.map((machine) => {
    const load = resolveMachineLoad(machine);
    return {
      id: machine.id,
      name: machine.name,
      policies: machine.state.settings.placementPolicies ?? [],
      projects: listMachineProjects(machine),
      repositories: listLooseRepositories(machine),
      open: load.open,
      capacity: load.capacity,
      resources: machine.resources ? resolveResourceSummary(machine.resources) : null,
    };
  });
}

export const PLACEMENT_SYSTEM = [
  'You choose which machine a new coding task runs on.',
  'Each machine runs its own Shinsa engine with its own disk, projects and repositories, and a task stays on the machine it starts on.',
  'Decide in this order.',
  'First, the policies the person wrote in plain English saying what runs where: when one speaks to this request, follow it; when two conflict, follow the one that matches the request most closely.',
  'Second, where the work lives: when the request is about a project or repository that only some machines hold, by its name, its code or its product, pick one of those machines, since a task cannot run where its repository is not.',
  'Third, room: pass over a machine at its task capacity while another has room, then prefer the machine with the most free CPU and memory, and avoid one nearly out of disk.',
  `Answer "${NO_PLACEMENT_MACHINE}" only when nothing sets one machine apart; the machine with the most room takes it then.`,
  'The reason is one short sentence in plain words that names the policy, the project or the room that decided it.',
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
  const projects =
    candidate.projects.length > 0
      ? candidate.projects.map((project) => `  - ${describePlacementProject(project)}`).join('\n')
      : '  (no projects)';
  const repositories =
    candidate.repositories.length > 0 ? [`Other repositories: ${candidate.repositories.join(', ')}`] : [];
  return [
    `Machine "${candidate.id}" named ${candidate.name} (${load}; ${use})`,
    'Policies:',
    policies,
    'Projects:',
    projects,
    ...repositories,
  ].join('\n');
}

function describePlacementProject(project: PlacementProject) {
  const repositories =
    project.repositories.length > 0 ? ` (repositories: ${project.repositories.join(', ')})` : '';
  const description = project.description.trim() ? `: ${project.description.trim()}` : '';
  return `${project.name}${repositories}${description}`;
}

export function serializePlacementPrompt(question: PlacementQuestion) {
  return [
    'Machines:',
    ...question.machines.map(describeCandidate),
    '',
    'The request:',
    question.request,
    '',
    `Answer with JSON: {"machine": the machine's id in quotes, or "${NO_PLACEMENT_MACHINE}", "reason": one sentence}.`,
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
  const { id, name, policies, projects, repositories, open, capacity, resources } = value as Record<
    string,
    unknown
  >;
  if (typeof id !== 'string' || !id || typeof name !== 'string') return null;
  if (!Array.isArray(policies) || !policies.every((policy) => typeof policy === 'string')) return null;
  if (!isPlacementPoliciesValid(policies)) return null;
  const held = readPlacementProjects(projects);
  const loose = readNames(repositories, PLACEMENT_PROJECT_LIMITS.repositories);
  if (!held || !loose) return null;
  if (typeof open !== 'number' || !Number.isInteger(open) || open < 0) return null;
  if (capacity !== null && (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1))
    return null;
  const reported = resources !== null && resources !== undefined;
  const use = reported ? parseResourceSummary(resources) : null;
  if (reported && !use) return null;
  return {
    id,
    name: name.slice(0, 120),
    policies,
    projects: held,
    repositories: loose,
    open,
    capacity,
    resources: use,
  };
}

function readNames(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length > limit) return null;
  if (!value.every((entry) => typeof entry === 'string')) return null;
  return value.map((entry: string) => entry.slice(0, PLACEMENT_PROJECT_LIMITS.name));
}

function readPlacementProject(value: unknown): PlacementProject | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, description, repositories } = value as Record<string, unknown>;
  if (typeof name !== 'string' || typeof description !== 'string') return null;
  const names = readNames(repositories, PLACEMENT_PROJECT_LIMITS.repositories);
  if (!names) return null;
  return {
    name: name.slice(0, PLACEMENT_PROJECT_LIMITS.name),
    description: description.slice(0, PLACEMENT_PROJECT_LIMITS.description),
    repositories: names,
  };
}

function readPlacementProjects(value: unknown) {
  if (!Array.isArray(value) || value.length > PLACEMENT_PROJECT_LIMITS.perMachine) return null;
  const projects = value.map(readPlacementProject);
  return projects.every((project): project is PlacementProject => project !== null) ? projects : null;
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
