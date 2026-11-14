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
import type { SearchField } from '@/lib/command/search/schema.ts';
import {
  createSearchField,
  KEYWORD_WEIGHT,
  LABEL_WEIGHT,
  listKeywordFields,
  parseQueryWords,
  scoreFields,
  scoreKeywords,
} from '@/lib/command/search/score.ts';
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

export type TaskAction = 'new' | 'jump';

export type MenuBlock =
  | { kind: 'section'; key: string; score: number; section: CommandSection; commands: Command[] }
  | { kind: 'recent'; key: string; score: number; tasks: Task[] }
  | { kind: 'decisions'; key: string; score: number; commands: Command[] }
  | {
      kind: 'tasks';
      key: string;
      score: number;
      tasks: Task[];
      actions: TaskAction[];
      actionsFirst: boolean;
      total: number;
    }
  | { kind: 'choice'; key: string; score: number; command: ChoiceCommand; options: ChoiceOption[] }
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
  fields: SearchField[];
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

const RELEVANCE_SHARE = 0.5;

const TASK_INDEXES = new WeakMap<ShinsaState, TaskEntry[]>();

const TASK_FIELDS = new WeakMap<Task, { repoName: string; fields: SearchField[] }>();

const BRANCH_WEIGHT = 0.8;

const SUMMARY_WEIGHT = 0.6;

const REQUEST_WEIGHT = 0.5;

const REQUEST_SEARCHED = 200;

export const FALLBACK_PREFIX = 'fallback:';

export const COMPOSE_VALUE = 'compose.submit';

export const JUMP_VALUE = 'tasks.jump';

const JUMP_KEYWORDS = ['Jump to a task', 'find', 'search', 'open', 'go to'];

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

function listStoredTaskFields(state: ShinsaState, task: Task) {
  const repoName = resolveRepoName(state, task);
  const known = TASK_FIELDS.get(task);
  if (known?.repoName === repoName) return known.fields;
  const fields = [
    createSearchField(task.title, LABEL_WEIGHT, true),
    createSearchField(task.handle ?? '', LABEL_WEIGHT, true),
    createSearchField((task.handle ?? '').replaceAll('-', ''), LABEL_WEIGHT, false),
    createSearchField(task.branch ?? '', BRANCH_WEIGHT, true),
    createSearchField(repoName, KEYWORD_WEIGHT, false),
    createSearchField(task.summary ?? '', SUMMARY_WEIGHT, false),
    createSearchField(task.request.slice(0, REQUEST_SEARCHED), REQUEST_WEIGHT, false),
  ].filter((field) => field.text !== '');
  TASK_FIELDS.set(task, { repoName, fields });
  return fields;
}

export function listTaskFields(state: ShinsaState, task: Task) {
  return [
    ...listStoredTaskFields(state, task),
    createSearchField(resolveTaskStatus(state, task).label, KEYWORD_WEIGHT, false),
  ];
}

export function resolveTaskIndex(state: ShinsaState): TaskEntry[] {
  const known = TASK_INDEXES.get(state);
  if (known) return known;
  const index = Object.values(state.tasks)
    .filter((task) => !isWatchHome(task))
    .sort((a, b) => Number(isTaskSettled(a)) - Number(isTaskSettled(b)) || b.updatedAt - a.updatedAt)
    .map((task) => ({ task, fields: listTaskFields(state, task) }));
  TASK_INDEXES.set(state, index);
  return index;
}

export function listMenuTasks(state: ShinsaState) {
  return resolveTaskIndex(state)
    .slice(0, TASKS_SHOWN)
    .map((entry) => entry.task);
}

export function listTaskMatches(index: TaskEntry[], query: string): TaskMatch[] {
  const words = parseQueryWords(query);
  const matches: TaskMatch[] = [];
  for (const entry of index) {
    const score = scoreFields(entry.fields, words);
    if (score > 0) matches.push({ task: entry.task, score });
  }
  return matches.sort((a, b) => b.score - a.score);
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

function scoreCommand(command: Command, words: string[]) {
  return scoreFields(listKeywordFields(listCommandKeywords(command)), words);
}

function scoreCommands(query: string, commands: Command[]) {
  const words = parseQueryWords(query);
  return commands
    .filter((command) => !isDisabled(command))
    .reduce((top, command) => Math.max(top, scoreCommand(command, words)), 0);
}

function listRanked<T>(items: T[], score: (item: T) => number) {
  return items
    .map((item) => ({ item, score: score(item) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);
}

function listCommandMatches(commands: Command[], query: string, floor = 0) {
  if (query === '') return commands;
  const words = parseQueryWords(query);
  return listRanked(commands, (command) => scoreCommand(command, words))
    .filter((match) => match.score >= floor)
    .slice(0, SECTION_MATCHES_SHOWN)
    .map((match) => match.item);
}

export function listChoiceMatches(command: ChoiceCommand, query: string, floor = 0) {
  if (query === '') return { options: command.options, score: 1 };
  const words = parseQueryWords(query);
  const ranked = listRanked(command.options, (option) =>
    scoreFields(listKeywordFields(listOptionKeywords(command, option)), words)
  ).filter((match) => match.score >= floor);
  const enabled = ranked.find((match) => !isDisabled(match.item));
  return { options: ranked.map((match) => match.item), score: enabled?.score ?? 0 };
}

export function listSectionBlocks(sections: CommandSection[], query: string, floor = 0): MenuBlock[] {
  return sections.flatMap((section) => {
    const commands = listCommandMatches(
      section.commands.filter((command) => isCommandShown(command, query !== '')),
      query,
      floor
    );
    if (commands.length === 0) return [];
    return [{ kind: 'section', key: section.id, score: scoreCommands(query, commands), section, commands }];
  });
}

function countMenuTasks(state: ShinsaState) {
  return Object.values(state.tasks).filter((task) => !isWatchHome(task)).length;
}

function resolveTasksBlock(menu: RootMenu, matches: TaskMatch[], floor: number): MenuBlock {
  const total = countMenuTasks(menu.state);
  if (menu.query === '') {
    return {
      kind: 'tasks',
      key: 'tasks',
      score: 1,
      tasks: [],
      actions: ['new', 'jump'],
      actionsFirst: true,
      total,
    };
  }
  const shown = matches.filter((match) => match.score >= floor);
  const scores: Record<TaskAction, number> = {
    new: scoreCommands(menu.query, [NEW_TASK_COMMAND]),
    jump: scoreKeywords(JUMP_KEYWORDS, menu.query),
  };
  const actions = (['new', 'jump'] as const).filter((action) => scores[action] > 0);
  const bestAction = Math.max(scores.new, scores.jump);
  const bestTask = shown[0]?.score ?? 0;
  return {
    kind: 'tasks',
    key: 'tasks',
    score: Math.max(bestAction, bestTask),
    tasks: shown.slice(0, TASK_MATCHES_SHOWN).map((match) => match.task),
    actions,
    actionsFirst: bestAction >= bestTask,
    total,
  };
}

function listTypedBlocks(sections: CommandSection[], query: string, floor: number): MenuBlock[] {
  const choices = listChoiceCommands(sections).flatMap((command): MenuBlock[] => {
    const matches = listChoiceMatches(command, query, floor);
    if (matches.options.length === 0) return [];
    return [{ kind: 'choice', key: command.id, score: matches.score, command, options: matches.options }];
  });
  const searches = listSearchCommands(sections);
  const search: MenuBlock[] =
    searches.length > 0 ? [{ kind: 'search', key: 'search', score: 0, commands: searches }] : [];
  return [...choices, ...search, { kind: 'new-task', key: 'new-task', score: 0 }];
}

function listLeadingBlocks(menu: RootMenu, listed: ReadonlySet<string>, floor: number): MenuBlock[] {
  const recent = listRecentTasks(menu.state, menu.recent, menu.currentTaskId, listed, menu.now);
  const decisions = menu.query === '' ? [] : listCommandMatches(menu.decisions, menu.query, floor);
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

function resolveRelevanceFloor(menu: RootMenu, matches: TaskMatch[]) {
  if (menu.query === '') return 0;
  const shown = menu.sections.flatMap((section) =>
    section.commands.filter((command) => isCommandShown(command, true))
  );
  const choices = listChoiceCommands(menu.sections).map(
    (command) => listChoiceMatches(command, menu.query).score
  );
  const best = Math.max(
    scoreCommands(menu.query, [...shown, ...menu.decisions]),
    matches[0]?.score ?? 0,
    ...choices
  );
  return best * RELEVANCE_SHARE;
}

export function listRootBlocks(menu: RootMenu) {
  const listed = listListedTaskIds(menu.registered);
  const matches =
    menu.query === ''
      ? []
      : listTaskMatches(resolveTaskIndex(menu.state), menu.query).filter(
          (match) => !listed.has(match.task.id)
        );
  const floor = resolveRelevanceFloor(menu, matches);
  const blocks = [
    ...listSectionBlocks(
      menu.sections.filter((section) => section.rank < RANK.global),
      menu.query,
      floor
    ),
    ...listLeadingBlocks(menu, listed, floor),
    resolveTasksBlock(menu, matches, floor),
    ...listSectionBlocks(
      menu.sections.filter((section) => section.rank >= RANK.global),
      menu.query,
      floor
    ),
    ...(menu.query === '' ? [] : listTypedBlocks(menu.sections, menu.query, floor)),
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
