import { Option, Schema } from 'effect';
import type { Settings } from '../domain/settings.ts';
import { isTaskSettled } from '../domain/stages.ts';
import type { Project, Repo, Task } from '../domain/types.ts';
import { describeResourceSummary, resolveResourceHeadroom, resolveResourceSummary } from './resources.ts';
import {
  PLACEMENT_LIMITS,
  PLACEMENT_PROJECT_LIMITS,
  type PlacementCandidate,
  PlacementPolicies,
  type PlacementProject,
  PlacementQuestion,
  PlacementReply,
  type ResourceSummary,
} from './schema.ts';

export interface PlacementMachine {
  id: string;
  name: string;
  state: {
    tasks: Record<string, Pick<Task, 'stage'>>;
    projects: Record<string, Pick<Project, 'name' | 'description'>>;
    repos: Record<string, Pick<Repo, 'name' | 'projectId'>>;
    settings: Pick<Settings, 'taskCapacity' | 'placementPolicies' | 'sharedTeams'>;
  };
  resources?: ResourceSummary | null;
}

export const isPlacementPoliciesValid = Schema.is(PlacementPolicies);

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
  return Option.map(
    Option.fromUndefinedOr(machines.find((machine) => projectId in machine.state.projects)),
    (machine) => machine.id
  );
}

export function resolvePlacement(machines: PlacementMachine[], projectId: string | null) {
  const owner = projectId ? resolveProjectMachine(machines, projectId) : Option.none<string>();
  if (Option.isSome(owner)) return owner;
  const loads = machines.map(resolveMachineLoad);
  const roomy = loads.filter((load) => !load.full);
  const compare = loads.every((load) => load.headroom !== null) ? compareHeadroom : compareLoads;
  const [best] = (roomy.length > 0 ? roomy : loads).sort(compare);
  return Option.map(Option.fromUndefinedOr(best), (load) => load.id);
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

export interface PlacementAnswer {
  machineId: string;
  reason: string;
}

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

const decodePlacementReply = Schema.decodeUnknownOption(PlacementReply);

const decodePlacementQuestion = Schema.decodeUnknownOption(PlacementQuestion);

export function parsePlacementAnswer(
  question: PlacementQuestion,
  value: unknown
): Option.Option<PlacementAnswer> {
  const reply = Option.getOrNull(decodePlacementReply(value));
  if (!reply || !question.machines.some((candidate) => candidate.id === reply.machine)) return Option.none();
  return Option.some({
    machineId: reply.machine,
    reason: reply.reason.trim().slice(0, PLACEMENT_LIMITS.reason),
  });
}

export function parsePlacementQuestion(value: unknown): Option.Option<PlacementQuestion> {
  return decodePlacementQuestion(value);
}
