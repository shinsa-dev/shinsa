import {
  describeCount,
  hasPlacementPolicies,
  listPlacementCandidates,
  type MachineLoad,
  type PlacementAnswer,
  type PlacementMachine,
  type PlacementQuestion,
  resolveMachineLoad,
  resolvePlacement,
  resolveProjectMachine,
  type ShinsaState,
  type Task,
  type TaskPriority,
  type UserCommand,
} from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import * as React from 'react';
import { requestJson } from '@/lib/connection/http.ts';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import { selectFocus } from '@/lib/focus.ts';
import { listPriorityItems } from '@/lib/format/labels.ts';
import { listProjects } from '@/lib/projects.ts';
import { MACHINE_ICON, resolveMachineLabel } from '@/lib/remote/mode.ts';

let pendingDraft: string | null = null;
const draftListeners = new Set<() => void>();

export function requestNewTask(draft = '') {
  pendingDraft = draft;
  for (const listener of draftListeners) listener();
}

export function useNewTaskRequest(apply: (draft: string) => void) {
  const latest = React.useRef(apply);
  latest.current = apply;
  React.useEffect(() => {
    const consume = () => {
      if (pendingDraft === null) return;
      const draft = pendingDraft;
      pendingDraft = null;
      latest.current(draft);
    };
    consume();
    draftListeners.add(consume);
    return () => {
      draftListeners.delete(consume);
    };
  }, []);
}

interface NewTaskCopy {
  placeholder: string;
  submit: string;
  done: string;
}

type AutoChoice<Value extends string> = Value | 'auto';

export const NO_PROJECT = 'none';

export interface NewTaskChoices {
  project: AutoChoice<string>;
  start: AutoChoice<'now' | string>;
  priority: AutoChoice<TaskPriority>;
  machine: AutoChoice<string>;
}

export const AUTO_CHOICES: NewTaskChoices = {
  project: 'auto',
  start: 'auto',
  priority: 'auto',
  machine: 'auto',
};

const PLACEHOLDER = 'Describe the work or ask a question. Shinsa decides what kind of task it is.';

export function describeNewTask(waits: boolean): NewTaskCopy {
  if (waits) {
    return {
      placeholder: PLACEHOLDER,
      submit: 'Add',
      done: 'Added. It starts when the task it waits on is finished.',
    };
  }
  return {
    placeholder: PLACEHOLDER,
    submit: 'Start',
    done: 'Started. It comes back when it needs a decision.',
  };
}

function resolveProjectId(project: string) {
  return project === NO_PROJECT ? null : project;
}

export function createNewTaskCommand(request: string, choices: NewTaskChoices): UserCommand {
  const { project, start, priority } = choices;
  return {
    type: 'task.create',
    request: request.trim(),
    repoId: null,
    ...(project === 'auto' ? {} : { projectId: resolveProjectId(project) }),
    ...(priority === 'auto' ? {} : { priority }),
    ...(start === 'auto' ? {} : { waitsOn: start === 'now' ? [] : [start] }),
  };
}

interface NewTaskItem<Value extends string> {
  value: Value;
  label: string;
  icon: MenuItemIcon;
  hint?: string;
}

export interface NewTaskProjectItem {
  value: string;
  label: string;
  color: string;
}

export function listNewTaskProjects(
  state: ShinsaState,
  selectMachine: (id: string) => { name: string } | null = () => null
): NewTaskProjectItem[] {
  return [
    { value: NO_PROJECT, label: 'No project', color: 'gray' },
    ...listProjects(state).map((project) => {
      const machine = selectMachine(project.id);
      return {
        value: project.id,
        label: machine ? `${project.name} on ${machine.name}` : project.name,
        color: project.color,
      };
    }),
  ];
}

export function resolveProjectChoice(state: ShinsaState, project: AutoChoice<string>): AutoChoice<string> {
  return project === NO_PROJECT || state.projects[project] ? project : 'auto';
}

export function resolveShownProject(state: ShinsaState, project: AutoChoice<string>, now = Date.now()) {
  if (project !== 'auto') return project;
  return selectFocus(state, now)?.id ?? NO_PROJECT;
}

export function listNewTaskPriorities(): NewTaskItem<AutoChoice<TaskPriority>>[] {
  return [{ value: 'auto', label: 'Auto priority', icon: 'IconChart3' }, ...listPriorityItems()];
}

export function listNewTaskStarts(open: Task[]): NewTaskItem<string>[] {
  return [
    { value: 'auto', label: 'Auto start', icon: 'IconCalenderSparkle' },
    { value: 'now', label: 'Start now', icon: 'IconRocket' },
    ...open.map((task) => ({ value: task.id, label: `After ${task.title}`, icon: 'IconHourglass' as const })),
  ];
}

export function isWaitingStart(start: string) {
  return start !== 'auto' && start !== 'now';
}

export function describeMachineLoad(load: Pick<MachineLoad, 'open' | 'capacity' | 'full'>) {
  if (load.capacity === null) return describeCount(load.open, 'open task');
  const share = `${load.open} of ${load.capacity} open tasks`;
  return load.full ? `${share}, full` : share;
}

function selectChosenMachine(machines: PlacementMachine[], machine: AutoChoice<string>) {
  return machine === 'auto' ? null : (machines.find((candidate) => candidate.id === machine) ?? null);
}

export interface NewTaskPlacement {
  id: string;
  byPolicy: boolean;
}

export function resolveNewTaskMachine(
  machines: PlacementMachine[],
  choices: Pick<NewTaskChoices, 'machine' | 'project'>,
  shownProject: string
): NewTaskPlacement | null {
  if (machines.length < 2) return null;
  const chosen = selectChosenMachine(machines, choices.machine);
  if (chosen) return { id: chosen.id, byPolicy: false };
  const named = choices.project === 'auto' || choices.project === NO_PROJECT ? null : choices.project;
  const owner = named ? resolveProjectMachine(machines, named) : null;
  if (owner) return { id: owner, byPolicy: false };
  const placed = resolvePlacement(machines, shownProject === NO_PROJECT ? null : shownProject);
  return placed ? { id: placed, byPolicy: hasPlacementPolicies(machines) } : null;
}

export type PlacementAsker = (question: PlacementQuestion) => Promise<{ answer: PlacementAnswer | null }>;

function askPlacement(question: PlacementQuestion) {
  return requestJson<{ answer: PlacementAnswer | null }>('/api/placement', question);
}

export async function requestPolicyPlacement(
  machines: PlacementMachine[],
  request: string,
  ask: PlacementAsker = askPlacement
) {
  try {
    const { answer } = await ask({ request, machines: listPlacementCandidates(machines) });
    return answer;
  } catch {
    return null;
  }
}

export function describePlacementDone(done: string, machine: MachineChoice | undefined, reason: string) {
  if (!machine) return done;
  const runs = `It runs on ${resolveMachineLabel(machine)}.`;
  return reason ? `${done} ${runs} ${reason}` : `${done} ${runs}`;
}

export function listNewTaskMachines(
  machines: MachineChoice[],
  placement: NewTaskPlacement | null
): NewTaskItem<string>[] {
  const automatic = machines.find((machine) => machine.id === placement?.id);
  return [
    {
      value: 'auto',
      label: placement?.byPolicy || !automatic ? 'Automatic' : `Automatic: ${resolveMachineLabel(automatic)}`,
      icon: 'IconSparkle',
      ...(placement?.byPolicy ? { hint: 'Your policies decide when you start it' } : {}),
    },
    ...machines.map((machine) => ({
      value: machine.id,
      label: resolveMachineLabel(machine),
      icon: MACHINE_ICON,
      hint: describeMachineLoad(resolveMachineLoad(machine)),
    })),
  ];
}

export function isProjectOnMachine(machines: PlacementMachine[], machineId: string | null, project: string) {
  const machine = machineId ? machines.find((candidate) => candidate.id === machineId) : undefined;
  return !machine || project === NO_PROJECT || project in machine.state.projects;
}
