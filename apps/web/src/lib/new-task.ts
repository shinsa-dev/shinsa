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

export type NewTaskStart = AutoChoice<'now' | 'after' | 'backlog'>;

export interface NewTaskChoices {
  project: AutoChoice<string>;
  start: NewTaskStart;
  after: string[];
  priority: AutoChoice<TaskPriority>;
}

export const AUTO_CHOICES: NewTaskChoices = { project: 'auto', start: 'auto', after: [], priority: 'auto' };

const PLACEHOLDER = 'Describe the work or ask a question. Shinsa decides what kind of task it is.';

export function describeNewTask(start: NewTaskStart): NewTaskCopy {
  if (start === 'after') {
    return {
      placeholder: PLACEHOLDER,
      submit: 'Add',
      done: 'Added. It starts when the tasks it waits on are finished.',
    };
  }
  if (start === 'backlog') {
    return {
      placeholder: PLACEHOLDER,
      submit: 'Add',
      done: 'Added to the backlog. It plans now and builds when you start it.',
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

function resolveStartFields(start: NewTaskStart, after: string[]) {
  if (start === 'now') return { waitsOn: [] };
  if (start === 'after') return { waitsOn: after };
  if (start === 'backlog') return { backlog: true };
  return {};
}

export function createNewTaskCommand(request: string, choices: NewTaskChoices): UserCommand {
  const { project, start, after, priority } = choices;
  return {
    type: 'task.create',
    request: request.trim(),
    repoId: null,
    ...(project === 'auto' ? {} : { projectId: resolveProjectId(project) }),
    ...(priority === 'auto' ? {} : { priority }),
    ...resolveStartFields(start, after),
  };
}

interface NewTaskItem<Value extends string> {
  value: Value;
  label: string;
  icon: MenuItemIcon;
  hint?: string;
  disabled?: string;
}

export interface NewTaskProjectItem {
  value: string;
  label: string;
  color: string;
}

export function listNewTaskProjects(state: ShinsaState): NewTaskProjectItem[] {
  return [
    { value: NO_PROJECT, label: 'No project', color: 'gray' },
    ...listProjects(state).map((project) => ({
      value: project.id,
      label: project.name,
      color: project.color,
    })),
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

export function describeAfterLabel(chosen: Pick<Task, 'title'>[]) {
  const [first] = chosen;
  if (!first) return 'After another task…';
  if (chosen.length === 1) return `After ${first.title}`;
  return `After ${first.title} and ${chosen.length - 1} more`;
}

export function listNewTaskStarts(open: Task[], after: string[]): NewTaskItem<NewTaskStart>[] {
  const chosen = open.filter((task) => after.includes(task.id));
  return [
    {
      value: 'auto',
      label: 'Auto start',
      icon: 'IconCalenderSparkle',
      hint: 'Now, or after work it builds on',
    },
    {
      value: 'now',
      label: 'Start now',
      icon: 'IconRocket',
      hint: 'Now, even if related work is open',
    },
    {
      value: 'after',
      label: describeAfterLabel(chosen),
      icon: 'IconHourglass',
      hint: 'When the tasks you pick finish',
      ...(open.length === 0 ? { disabled: 'No open task to wait for' } : {}),
    },
    {
      value: 'backlog',
      label: 'Backlog',
      icon: 'IconArchive',
      hint: 'Plans now, builds when you start it',
    },
  ];
}

export function resolveStartChoice(choices: Pick<NewTaskChoices, 'start' | 'after'>, open: Task[]) {
  const ids = new Set(open.map((task) => task.id));
  const after = choices.after.filter((id) => ids.has(id));
  if (choices.start === 'after' && after.length === 0) return { start: 'auto' as const, after };
  return { start: choices.start, after };
}

export function toggleAfterTask(after: string[], taskId: string): Pick<NewTaskChoices, 'start' | 'after'> {
  const next = after.includes(taskId) ? after.filter((id) => id !== taskId) : [...after, taskId];
  return { start: next.length > 0 ? 'after' : 'auto', after: next };
}
