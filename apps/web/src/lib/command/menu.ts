import {
  isListedInFocus,
  isTaskSettled,
  isWatchHome,
  resolveQueue,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { listOpenGateCommands } from '@/lib/command/gates.ts';
import {
  type ChoiceOption,
  type Command,
  type CommandSection,
  isChosen,
  isDisabled,
  type MenuPage,
  RANK,
} from '@/lib/command/registry.ts';
import { scoreCommand } from '@/lib/command/score.ts';
import { requestNewTask } from '@/lib/new-task.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate, type Route } from '@/router.ts';

export type ChoiceCommand = Extract<Command, { kind: 'choice' }>;

export type SearchCommand = Extract<Command, { kind: 'search' }>;

export type Frame = MenuPage | { kind: 'choice'; command: ChoiceCommand } | { kind: 'tasks' };

export interface Visit {
  frame: Frame;
  from: string;
}

export type MenuBlock =
  | { kind: 'section'; key: string; score: number; section: CommandSection; commands: Command[] }
  | { kind: 'recent'; key: string; score: number; tasks: Task[] }
  | { kind: 'decisions'; key: string; score: number; commands: Command[] }
  | { kind: 'tasks'; key: string; score: number; tasks: Task[]; total: number }
  | { kind: 'choice'; key: string; score: number; command: ChoiceCommand }
  | { kind: 'search'; key: string; score: number; commands: SearchCommand[] }
  | { kind: 'new-task'; key: string; score: number };

export interface RootMenu {
  state: ShinsaState;
  sections: CommandSection[];
  registered: CommandSection[];
  decisions: Command[];
  recent: string[];
  currentTaskId: string | null;
  query: string;
  now: number;
}

export interface TaskEntry {
  task: Task;
  keywords: string[];
}

export interface TaskMatch {
  task: Task;
  score: number;
}

export const TASKS_FRAME: Frame = { kind: 'tasks' };

const RECENT_SHOWN = 5;

const TASKS_SHOWN = 300;

export const TASK_MATCHES_SHOWN = 20;

const JUMP_MATCHES_SHOWN = 100;

export const SECTION_MATCHES_SHOWN = 20;

const TASK_INDEXES = new WeakMap<ShinsaState, TaskEntry[]>();

export const COMPOSE_VALUE = 'compose.submit';

export const JUMP_VALUE = 'tasks.jump';

export const JUMP_KEYWORDS = ['Jump to a task', 'find', 'search', 'open', 'go to'];

export function requestNewTaskOnHome(draft = '') {
  navigate('/');
  requestNewTask(draft);
}

export const NEW_TASK_COMMAND: Extract<Command, { kind: 'run' }> = {
  kind: 'run',
  id: 'go.new',
  label: 'New task',
  icon: 'IconPlusMedium',
  keywords: ['create', 'start', 'add', 'compose', 'write'],
  run: () => requestNewTaskOnHome(),
};

export function resolveRepoName(state: ShinsaState, task: Task) {
  return task.repoId ? (state.repos[task.repoId]?.name ?? '') : '';
}

export function listCommandKeywords(command: Command) {
  return [command.label, command.hint ?? '', ...(command.keywords ?? [])];
}

export function listOptionKeywords(command: ChoiceCommand, option: ChoiceOption) {
  return [option.label, command.heading, command.label, ...(option.keywords ?? [])];
}

export function listTaskKeywords(state: ShinsaState, task: Task) {
  return [
    task.title,
    task.handle ?? '',
    resolveRepoName(state, task),
    task.branch ?? '',
    resolveTaskStatus(state, task).label,
    task.request.slice(0, 200),
  ];
}

export function resolveTaskIndex(state: ShinsaState): TaskEntry[] {
  const known = TASK_INDEXES.get(state);
  if (known) return known;
  const index = Object.values(state.tasks)
    .filter((task) => !isWatchHome(task))
    .sort((a, b) => Number(isTaskSettled(a)) - Number(isTaskSettled(b)) || b.updatedAt - a.updatedAt)
    .map((task) => ({ task, keywords: listTaskKeywords(state, task) }));
  TASK_INDEXES.set(state, index);
  return index;
}

export function listMenuTasks(state: ShinsaState) {
  return resolveTaskIndex(state)
    .slice(0, TASKS_SHOWN)
    .map((entry) => entry.task);
}

export function listTaskMatches(index: TaskEntry[], query: string): TaskMatch[] {
  return index
    .map((entry) => ({
      task: entry.task,
      score: scoreCommand(`task:${entry.task.id}`, query, entry.keywords),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function listJumpEntries(state: ShinsaState, query: string): TaskEntry[] {
  const index = resolveTaskIndex(state);
  if (query === '') return index.slice(0, TASKS_SHOWN);
  const entries = new Map(index.map((entry) => [entry.task.id, entry]));
  return listTaskMatches(index, query)
    .slice(0, JUMP_MATCHES_SHOWN)
    .flatMap((match) => entries.get(match.task.id) ?? []);
}

export function resolveFirstValue(frame: Frame, tasks: Task[]): string {
  if (frame.kind === 'compose') return COMPOSE_VALUE;
  if (frame.kind === 'tasks') return tasks[0] ? `jump:${tasks[0].id}` : '';
  if (frame.kind === 'choice') {
    const enabled = frame.command.options.filter((candidate) => !isDisabled(candidate));
    const option = enabled.find((candidate) => isChosen(frame.command, candidate.value)) ?? enabled[0];
    return option ? `${frame.command.id}:${option.value}` : '';
  }
  const first = [...frame.sections]
    .sort((a, b) => a.rank - b.rank)
    .flatMap((section) => section.commands)
    .find((command) => !isDisabled(command) && !command.searchOnly);
  return first?.id ?? '';
}

export function resolveCrumb(frame: Frame) {
  if (frame.kind === 'tasks') return 'Tasks';
  return frame.kind === 'choice' ? frame.command.heading : frame.crumb;
}

export function resolvePlaceholder(frame: Frame | undefined, route: Route) {
  if (!frame) {
    if (route.name === 'task') return 'Act on this task, jump to another, or type a new one…';
    return 'Search tasks and actions, or describe a new task…';
  }
  if (frame.kind === 'tasks') return 'Jump to a task…';
  if (frame.kind === 'choice') return `${frame.command.label.replace(/…$/, '')}…`;
  return frame.placeholder;
}

export function listListedTaskIds(sections: CommandSection[]) {
  return new Set(
    sections.flatMap((section) =>
      section.commands.flatMap((command) => (command.kind === 'go' && command.taskId ? [command.taskId] : []))
    )
  );
}

export function listRecentTasks(
  state: ShinsaState,
  recent: string[],
  currentTaskId: string | null,
  listed: ReadonlySet<string>,
  now: number
) {
  return recent
    .filter((id) => id !== currentTaskId && !listed.has(id))
    .flatMap((id) => state.tasks[id] ?? [])
    .filter((task) => isListedInFocus(state, task, now))
    .slice(0, RECENT_SHOWN);
}

export function listDecisionCommands(
  state: ShinsaState,
  currentTaskId: string | null,
  registered: CommandSection[]
): Command[] {
  const registeredIds = new Set(
    registered.flatMap((section) => section.commands.map((command) => command.id))
  );
  const tasks = new Map(resolveQueue(state, Date.now()).ready.map((entry) => [entry.task.id, entry.task]));
  return [...tasks.values()]
    .filter((task) => task.id !== currentTaskId)
    .flatMap((task) =>
      listOpenGateCommands(state, task, { comments: [], clearComments: () => {}, verdicts: {}, tab: null })
        .filter((command) => !registeredIds.has(command.id))
        .map((command): Command => ({
          ...command,
          id: `queue:${command.id}`,
          taskId: task.id,
          hint: task.title,
        }))
    );
}

export function listChoiceCommands(sections: CommandSection[]) {
  return sections.flatMap((section) =>
    section.commands.filter((command): command is ChoiceCommand => command.kind === 'choice')
  );
}

export function listSearchCommands(sections: CommandSection[]) {
  return sections.flatMap((section) =>
    section.commands.filter((command): command is SearchCommand => command.kind === 'search')
  );
}

export function isCommandShown(command: Command, typing: boolean) {
  return command.kind !== 'search' && (typing || !command.searchOnly);
}

function scoreBest(query: string, entries: { value: string; keywords: string[] }[]) {
  return entries.reduce((top, entry) => Math.max(top, scoreCommand(entry.value, query, entry.keywords)), 0);
}

function scoreCommands(query: string, commands: Command[]) {
  return scoreBest(
    query,
    commands
      .filter((command) => !isDisabled(command))
      .map((command) => ({ value: command.id, keywords: listCommandKeywords(command) }))
  );
}

function listCommandMatches(commands: Command[], query: string) {
  if (query === '') return commands;
  return commands
    .map((command) => ({ command, score: scoreCommand(command.id, query, listCommandKeywords(command)) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SECTION_MATCHES_SHOWN)
    .map((match) => match.command);
}

export function listSectionBlocks(sections: CommandSection[], query: string): MenuBlock[] {
  return sections.flatMap((section) => {
    const commands = listCommandMatches(
      section.commands.filter((command) => isCommandShown(command, query !== '')),
      query
    );
    if (commands.length === 0) return [];
    return [{ kind: 'section', key: section.id, score: scoreCommands(query, commands), section, commands }];
  });
}

function countMenuTasks(state: ShinsaState) {
  return Object.values(state.tasks).filter((task) => !isWatchHome(task)).length;
}

function resolveTasksBlock(menu: RootMenu, listed: ReadonlySet<string>): MenuBlock {
  const total = countMenuTasks(menu.state);
  if (menu.query === '') return { kind: 'tasks', key: 'tasks', score: 1, tasks: [], total };
  const matches = listTaskMatches(resolveTaskIndex(menu.state), menu.query);
  const jump = { value: JUMP_VALUE, keywords: JUMP_KEYWORDS };
  return {
    kind: 'tasks',
    key: 'tasks',
    score: Math.max(
      scoreCommands(menu.query, [NEW_TASK_COMMAND]),
      scoreBest(menu.query, [jump]),
      matches[0]?.score ?? 0
    ),
    tasks: matches
      .filter((match) => !listed.has(match.task.id))
      .slice(0, TASK_MATCHES_SHOWN)
      .map((match) => match.task),
    total,
  };
}

function listTypedBlocks(sections: CommandSection[], query: string): MenuBlock[] {
  const choices = listChoiceCommands(sections).map((command): MenuBlock => ({
    kind: 'choice',
    key: command.id,
    score: scoreBest(
      query,
      command.options
        .filter((option) => !isDisabled(option))
        .map((option) => ({
          value: `${command.id}:${option.value}`,
          keywords: listOptionKeywords(command, option),
        }))
    ),
    command,
  }));
  const searches = listSearchCommands(sections);
  const search: MenuBlock[] =
    searches.length > 0 ? [{ kind: 'search', key: 'search', score: 0, commands: searches }] : [];
  return [...choices, ...search, { kind: 'new-task', key: 'new-task', score: 0 }];
}

function listLeadingBlocks(menu: RootMenu, listed: ReadonlySet<string>): MenuBlock[] {
  const recent = listRecentTasks(menu.state, menu.recent, menu.currentTaskId, listed, menu.now);
  const decisions = menu.query === '' ? [] : menu.decisions;
  const blocks: MenuBlock[] = [];
  if (menu.query === '' && recent.length > 0)
    blocks.push({ kind: 'recent', key: 'recent', score: 1, tasks: recent });
  if (decisions.length > 0) {
    blocks.push({
      kind: 'decisions',
      key: 'decisions',
      score: scoreCommands(menu.query, decisions),
      commands: decisions,
    });
  }
  return blocks;
}

export function listRootBlocks(menu: RootMenu) {
  const listed = listListedTaskIds(menu.registered);
  const blocks = [
    ...listSectionBlocks(
      menu.sections.filter((section) => section.rank < RANK.global),
      menu.query
    ),
    ...listLeadingBlocks(menu, listed),
    resolveTasksBlock(menu, listed),
    ...listSectionBlocks(
      menu.sections.filter((section) => section.rank >= RANK.global),
      menu.query
    ),
    ...(menu.query === '' ? [] : listTypedBlocks(menu.sections, menu.query)),
  ];
  return arrangeByScore(blocks, menu.query !== '');
}

export function arrangeByScore<T extends { score: number }>(blocks: T[], typing: boolean) {
  if (!typing) return blocks;
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => b.block.score - a.block.score || a.index - b.index)
    .map(({ block }) => block);
}
