import {
  type AccountsSnapshot,
  isTaskSettled,
  listDecisionOrder,
  listPendingDependencies,
  resolveQueue,
  resolveQueueStep,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import {
  listAccountBindingCommands,
  listRerunCommands,
  listUsageWaitCommands,
} from '@/lib/command/accounts.ts';
import { type GateContext, listOpenGateCommands } from '@/lib/command/gates.ts';
import { listProcessCommands } from '@/lib/command/process.ts';
import { type Command, type CommandSection, type MenuPage, RANK } from '@/lib/command/registry.ts';
import { listTaskActionCommands } from '@/lib/command/task-actions.ts';
import type { LineComment } from '@/lib/review/draft.ts';
import {
  clearDependencies,
  listDependencyChoices,
  resolveDependencyLabel,
  toggleDependency,
} from '@/lib/tasks/dependencies.ts';
import { resolveTaskMenuIcon } from '@/lib/tasks/status.ts';
import { listTaskTabs, TASK_TAB, type TaskTab } from '@/lib/tasks/tabs.ts';
import { resolveTaskPath } from '@/router.ts';

export interface TaskPageContext {
  tab: TaskTab;
  tabs: TaskTab[];
  applyTab: (tab: TaskTab) => void;
  comments: LineComment[];
  clearComments: () => void;
}

const NO_GATE_CONTEXT: GateContext = { comments: [], clearComments: () => {}, tab: null };

function listDependencyCommands(state: ShinsaState, task: Task): Command[] {
  if (isTaskSettled(task)) return [];
  const id = `task.${task.id}.dependency`;
  const hint = listPendingDependencies(state, task)
    .map((dependency) => dependency.title)
    .join(', ');
  const choices = listDependencyChoices(state, task);
  const commands: Command[] = [];
  if (choices.length > 0) {
    commands.push({
      kind: 'choice',
      id: `${id}.wait`,
      label: `${resolveDependencyLabel(task)}…`,
      ...(hint ? { hint } : {}),
      icon: 'IconHourglass',
      keywords: ['wait', 'after', 'depends', 'dependency', 'blocked', 'chain', 'roadmap', 'order'],
      heading: 'Waits on',
      value: task.waitsOn,
      options: choices.map((choice) => ({
        value: choice.id,
        label: choice.title,
        icon: resolveTaskMenuIcon(state, choice),
        keywords: [choice.branch ?? ''],
      })),
      pick: (value) => {
        const dependency = state.tasks[value];
        if (dependency) void toggleDependency(task, dependency);
      },
    });
  }
  if (task.waitsOn.length > 0) {
    commands.push({
      kind: 'run',
      id: `${id}.clear`,
      label: 'Stop waiting',
      ...(hint ? { hint } : {}),
      icon: 'IconCrossMedium',
      keywords: ['wait', 'dependency', 'start now', 'unblock', 'remove'],
      run: () => void clearDependencies(task),
    });
  }
  return commands;
}

function listThisTaskCommands(state: ShinsaState, task: Task, accounts: AccountsSnapshot | null) {
  return [
    ...listProcessCommands(state, task, Date.now()),
    ...listUsageWaitCommands(task),
    ...listDependencyCommands(state, task),
    ...listAccountBindingCommands(accounts, task),
    ...listRerunCommands(state, accounts, task),
    ...listTaskActionCommands(state, task),
  ];
}

function listTabCommands(
  task: Task,
  tabs: TaskTab[],
  current: TaskTab | null,
  apply?: (tab: TaskTab) => void
) {
  return tabs.map((tab): Command => {
    const base = { id: `task.${task.id}.tab.${tab}`, label: TASK_TAB[tab].label, icon: TASK_TAB[tab].icon };
    if (apply) {
      return {
        ...base,
        kind: 'run',
        current: tab === current,
        keywords: ['tab', 'switch', 'view', 'show'],
        run: () => apply(tab),
      };
    }
    return {
      ...base,
      kind: 'go',
      keywords: ['tab', 'open', 'view'],
      to: resolveTaskPath(task, tab === 'overview' ? {} : { tab }),
    };
  });
}

function listViewCommands(task: Task, page: TaskPageContext): Command[] {
  return listTabCommands(task, page.tabs, page.tab, page.applyTab);
}

function listTravelCommands(state: ShinsaState, task: Task): Command[] {
  const step = resolveQueueStep(listDecisionOrder(resolveQueue(state, Date.now())), task.id);
  const next = step.nextId ? state.tasks[step.nextId] : undefined;
  const previous = step.previousId ? state.tasks[step.previousId] : undefined;
  const travel: Command[] = [];
  if (next) {
    travel.push({
      kind: 'go',
      id: 'queue.next',
      label: 'Next task that needs you',
      hint: next.title,
      icon: 'IconArrowRight',
      taskId: next.id,
      keywords: ['next', 'queue', 'decision', 'forward'],
      to: resolveTaskPath(next),
    });
  }
  if (previous) {
    travel.push({
      kind: 'go',
      id: 'queue.previous',
      label: 'Previous task that needs you',
      hint: previous.title,
      icon: 'IconArrowLeft',
      taskId: previous.id,
      keywords: ['previous', 'back', 'queue', 'decision'],
      to: resolveTaskPath(previous),
    });
  }
  return travel;
}

export function resolveTaskPage(state: ShinsaState, task: Task, accounts: AccountsSnapshot | null): MenuPage {
  const decide = listOpenGateCommands(state, task, NO_GATE_CONTEXT);
  return {
    kind: 'list',
    crumb: task.title,
    placeholder: 'Act on this task…',
    sections: [
      ...(decide.length > 0
        ? [{ id: 'decide', heading: 'Decide', rank: RANK.context, commands: decide }]
        : []),
      {
        id: 'open',
        heading: 'Open',
        rank: RANK.context,
        commands: listTabCommands(task, listTaskTabs(task), null),
      },
      {
        id: 'task',
        heading: 'Task',
        rank: RANK.context,
        commands: listThisTaskCommands(state, task, accounts),
      },
    ],
  };
}

export function listTaskPageSections(
  state: ShinsaState,
  task: Task,
  page: TaskPageContext,
  accounts: AccountsSnapshot | null
): CommandSection[] {
  const context: GateContext = { comments: page.comments, clearComments: page.clearComments, tab: page.tab };
  const decide = listOpenGateCommands(state, task, context);
  const travel = listTravelCommands(state, task);
  return [
    ...(decide.length > 0
      ? [{ id: 'task.decide', heading: 'Decide on this task', rank: RANK.context, commands: decide }]
      : []),
    { id: 'task.view', heading: 'View', rank: RANK.context + 1, commands: listViewCommands(task, page) },
    {
      id: 'task.actions',
      heading: 'This task',
      rank: RANK.context + 2,
      commands: listThisTaskCommands(state, task, accounts),
    },
    ...(travel.length > 0
      ? [{ id: 'task.queue', heading: 'Needs you', rank: RANK.next, commands: travel }]
      : []),
  ];
}
