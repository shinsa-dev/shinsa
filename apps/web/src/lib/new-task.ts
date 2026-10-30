import type { ShinsaState, Task, TaskPriority, UserCommand } from '@shinsa/core';
import type { MenuItemIcon } from '@shinsa/ui/components/menu-icon';
import * as React from 'react';
import { selectFocus } from '@/lib/focus.ts';
import { listPriorityItems } from '@/lib/format/labels.ts';
import { listProjects } from '@/lib/projects.ts';

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
}

export const AUTO_CHOICES: NewTaskChoices = { project: 'auto', start: 'auto', priority: 'auto' };

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
