import {
  isTaskSettled,
  listProjectRepos,
  type Project,
  resolveRoundTitle,
  resolveTaskProject,
  resolveTaskShape,
  type ShinsaState,
  selectFolderProject,
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
  type TaskShape,
  type TaskSize,
  type TriageReasons,
} from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import {
  type ChoiceQuestion,
  type ChoicesQuestion,
  describeDecisionQuestion,
  parseDecisionAnswer,
  resolveDecisionProperty,
} from '../agents/quick/decide.ts';
import type { QuickJson } from '../agents/quick/index.ts';
import { BRANCH_PATTERN, COMMIT_TYPES, slugify } from '../git/index.ts';
import { type LocalRepo, listLocalRepos, resolveContainingRepo } from '../repos/index.ts';
import { parseAnswerText, SHAPE_QUESTION } from './decisions.ts';

export interface TriageResult {
  title: string;
  repoPath: string | null;
  size: TaskSize;
  branch: string;
  waitsOn: Task[];
  shape?: TaskShape;
  priority?: TaskPriority;
  reasons?: TriageReasons;
}

interface TriageAnswer {
  title?: unknown;
  repo?: unknown;
  size?: unknown;
  branch?: unknown;
  waits_on?: unknown;
  shape?: unknown;
  priority?: unknown;
  shape_why?: unknown;
  priority_why?: unknown;
  waits_on_why?: unknown;
}

interface TriageAsks {
  shape: boolean;
  priority: boolean;
  start: boolean;
  why: boolean;
}

interface KeptDependencies {
  waitsOn: Task[];
  dropped: boolean;
}

interface ParsedDecisions {
  shape: TaskShape | null;
  priority: TaskPriority | null;
  waitsOn: KeptDependencies | null;
}

const WHY_LIMIT = 120;

const TITLE_LIMIT = 60;

export const NO_REPOSITORY = 'none';

export const REPOSITORY_RULE = `Never pick a repository only because it is the only one listed or because it was worked on recently; pick one when the request names it or clearly needs its code. "The repo", "the code" or "the project" alone names none. A request that names a repository that is not listed gets "${NO_REPOSITORY}".`;

const TRIAGE_SYSTEM = [
  'You route a request to a repository on the developer’s machine, or to none, and size it.',
  'Return {"title": string, "repo": string, "branch": string} and one field for each decision listed after the request.',
  `title: what will be done, imperative, sentence case, at most ${TITLE_LIMIT} characters, no trailing period.`,
  `repo: the exact name of the repository the work belongs in, or "${NO_REPOSITORY}".`,
  `Answer "${NO_REPOSITORY}" when the request needs no repository: a greeting, small talk, a general question, a question about the state Shinsa keeps (its tasks, projects or settings, or what it knows) rather than code, a request to set up a Shinsa automation (a schedule, a trigger or a watch of an integration such as “watch #feedback for bugs, hourly”) rather than code such as a cron job in a repository, or planning that names no code.`,
  REPOSITORY_RULE,
  `branch: <type>/<short-kebab-slug>, type one of ${COMMIT_TYPES.join(', ')}, the conventional commit type of the work.`,
  'The decisions: answer each only with its options.',
  `Each field ending in _why says in one plain sentence of at most ${WHY_LIMIT} characters why you answered its decision that way.`,
].join('\n');

const QUESTION_NOTE =
  'This request is a question to answer from the code, not work to do. Title it by what it asks about, as a short phrase (for example “How the export sizes its chunks”).';

const LARGE_HINT =
  /\b(rework|redesign|rewrite|migrate|architecture|new feature|build out|overhaul|refactor the|spec)\b/i;

const SIZE_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'How big is the work?',
  criteria: {
    small: 'a contained fix or change with an obvious approach',
    large: 'a new feature, a change across several areas, the data model, or anything ambiguous',
  },
};

const PRIORITY_MEANINGS: Record<TaskPriority, string> = {
  urgent: 'something is broken or blocking work right now and comes before everything else',
  high: 'important, to pick up soon',
  normal: 'ordinary work, the usual answer',
  low: 'nice to have, can wait behind the rest',
};

const PRIORITY_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'How soon does this need doing, next to the other work?',
  criteria: Object.fromEntries(TASK_PRIORITIES.map((priority) => [priority, PRIORITY_MEANINGS[priority]])),
};

const SHAPE_NOUN: Record<TaskShape, string> = {
  answer: 'a question',
  investigate: 'an investigation',
  research: 'research',
  change: 'a change',
  fix: 'a fix',
  operation: 'an operation',
};

const UNCLASSIFIED = 'Shinsa could not classify the request, so';

function resolveWaitsOnQuestion(open: Task[]): ChoicesQuestion {
  return {
    type: 'choices',
    instructions:
      'Which open tasks must be finished before this one can start? Often none. Name a task only when this request clearly needs its work to exist first: it extends, uses or changes what that task builds. Related but independent work is left out; it runs in parallel.',
    criteria: Object.fromEntries(open.map((task) => [task.id, task.title])),
  };
}

function resolveAsks(task: Task): TriageAsks {
  return { ...task.auto, why: true };
}

function listWhyKeys(asks: TriageAsks) {
  if (!asks.why) return [];
  return [
    ...(asks.shape ? ['shape_why'] : []),
    ...(asks.priority ? ['priority_why'] : []),
    ...(asks.start ? ['waits_on_why'] : []),
  ];
}

export function resolveRepoProperty(candidates: LocalRepo[], optional: boolean) {
  return {
    type: 'string',
    enum: [...candidates.map((candidate) => candidate.name), ...(optional ? [NO_REPOSITORY] : [])],
  };
}

export function describeRepoCandidates(candidates: LocalRepo[]) {
  return [
    'Repositories:',
    ...(candidates.length > 0
      ? candidates.map((candidate) => `- ${candidate.name}: ${candidate.path}`)
      : ['(none)']),
  ];
}

export function parseRepoAnswer(candidates: LocalRepo[], value: unknown, optional: boolean) {
  if (optional && value === NO_REPOSITORY) return null;
  return candidates.find((candidate) => candidate.name === value)?.path;
}

function resolveTriageSchema(plan: TriagePlan): JsonSchema {
  const { asks } = plan;
  const properties: Record<string, unknown> = {
    title: { type: 'string', maxLength: TITLE_LIMIT },
    repo: resolveRepoProperty(plan.candidates, plan.optional),
    size: resolveDecisionProperty(SIZE_QUESTION),
    branch: { type: 'string', pattern: BRANCH_PATTERN.source },
  };
  if (asks.shape) properties.shape = resolveDecisionProperty(SHAPE_QUESTION);
  if (asks.priority) properties.priority = resolveDecisionProperty(PRIORITY_QUESTION);
  if (asks.start) properties.waits_on = resolveDecisionProperty(plan.waitsOnQuestion);
  for (const key of listWhyKeys(asks)) properties[key] = { type: 'string', maxLength: WHY_LIMIT };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function resolveFallbackSize(task: Task): TaskSize {
  return task.planFirst || task.request.length > 500 || LARGE_HINT.test(task.request) ? 'large' : 'small';
}

function resolveFallbackReasons(task: Task, asks: TriageAsks): TriageReasons {
  if (!asks.why) return {};
  return {
    ...(asks.shape
      ? { shape: `${UNCLASSIFIED} it is treated as ${SHAPE_NOUN[resolveTaskShape(task)]}.` }
      : {}),
    ...(asks.priority ? { priority: `${UNCLASSIFIED} it keeps the ${task.priority} priority.` } : {}),
    ...(asks.start ? { start: `${UNCLASSIFIED} it starts without waiting on other tasks.` } : {}),
  };
}

function describeStart(waitsOn: Task[]) {
  return waitsOn.length > 0
    ? 'It needs the work of another open task first.'
    : 'It does not need the work of another open task.';
}

function resolveStartReason(answer: TriageAnswer, fallback: TriageReasons, kept: KeptDependencies | null) {
  if (!kept) return fallback.start;
  const why = kept.dropped ? null : parseAnswerText(answer.waits_on_why, WHY_LIMIT);
  return why ?? describeStart(kept.waitsOn);
}

function resolveAnswerReasons(
  answer: TriageAnswer,
  fallback: TriageReasons,
  asks: TriageAsks,
  parsed: ParsedDecisions
): TriageReasons {
  if (!asks.why) return {};
  const reasons: TriageReasons = {};
  if (asks.shape) {
    reasons.shape = parsed.shape
      ? (parseAnswerText(answer.shape_why, WHY_LIMIT) ?? `The request reads as ${SHAPE_NOUN[parsed.shape]}.`)
      : fallback.shape;
  }
  if (asks.priority) {
    reasons.priority = parsed.priority
      ? (parseAnswerText(answer.priority_why, WHY_LIMIT) ??
        `The request reads as ${parsed.priority} priority work.`)
      : fallback.priority;
  }
  if (asks.start) reasons.start = resolveStartReason(answer, fallback, parsed.waitsOn);
  return reasons;
}

interface CandidatePool {
  project: Project | null;
  candidates: LocalRepo[];
  named: LocalRepo[];
  empty: boolean;
  outside: string[];
}

function listCandidates(state: ShinsaState, local: LocalRepo[], registered = Object.values(state.repos)) {
  const byPath = new Map(local.map((repo) => [repo.path, repo]));
  for (const repo of registered) {
    if (!byPath.has(repo.path)) byPath.set(repo.path, { path: repo.path, name: repo.name, touchedAt: 0 });
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

function resolveWords(text: string) {
  return ` ${text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;
}

function isRepoNamed(text: string, name: string) {
  const words = resolveWords(name);
  return words.trim() !== '' && resolveWords(text).includes(words);
}

export function resolveCandidatePool(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  text = task.request
): CandidatePool {
  const projectId = resolveTaskProject(state, task);
  const project = projectId ? (state.projects[projectId] ?? null) : null;
  const everywhere = listCandidates(state, local);
  if (!project) return { project: null, candidates: everywhere, named: [], empty: false, outside: [] };
  const candidates = listCandidates(
    state,
    listLocalRepos(project.folders),
    listProjectRepos(state, project.id)
  );
  if (candidates.length === 0) {
    return { project, candidates: everywhere, named: [], empty: true, outside: [] };
  }
  const inside = new Set(candidates.map((candidate) => candidate.path));
  const rest = everywhere.filter((candidate) => !inside.has(candidate.path));
  const named = rest.filter((candidate) => isRepoNamed(text, candidate.name));
  const outside = rest
    .filter((candidate) => !isRepoNamed(text, candidate.name))
    .map((candidate) => candidate.name);
  return { project, candidates, named, empty: false, outside: [...new Set(outside)] };
}

export function listOfferedRepos(pool: CandidatePool) {
  return [...pool.candidates, ...pool.named];
}

export function resolveRepoProject(state: ShinsaState, task: Task, path: string) {
  const folder = selectFolderProject(Object.values(state.projects), path);
  if (folder) return folder.id;
  const pool = resolveCandidatePool(state, task, []);
  return pool.project && pool.empty ? pool.project.id : null;
}

export function describeProject(pool: CandidatePool) {
  if (!pool.project) return [];
  return [
    'Project:',
    `- name: ${pool.project.name}`,
    `- key: ${pool.project.key}`,
    ...(pool.project.description ? [`- description: ${pool.project.description}`] : []),
    ...(pool.empty
      ? ['The project has no repository yet, so every repository on the machine is offered.']
      : []),
    ...(pool.named.length > 0
      ? [
          `Repositories outside this project, offered because the request names them: ${pool.named.map((candidate) => candidate.name).join(', ')}. Pick one only for the work the request names it for; the task stays in this project.`,
        ]
      : []),
    ...(pool.outside.length > 0
      ? [
          `Other repositories on the machine outside this project, never offered: ${pool.outside.join(', ')}. A request that names one of them gets "${NO_REPOSITORY}".`,
        ]
      : []),
    '',
  ];
}

function describeOpenTask(state: ShinsaState, task: Task) {
  const repo = state.repos[task.repoId ?? '']?.name ?? 'no repository yet';
  return `- ${task.id}: ${task.title} (${repo}, ${task.stage})`;
}

function describeHumanChoices(state: ShinsaState, task: Task) {
  const choices = [
    ...(task.auto.shape ? [] : [`the kind of task is ${resolveTaskShape(task)}`]),
    ...(task.auto.priority ? [] : [`the priority is ${task.priority}`]),
  ];
  if (!task.auto.start) {
    const titles = task.waitsOn.map((id) => `“${state.tasks[id]?.title ?? 'another task'}”`);
    choices.push(titles.length > 0 ? `it waits for ${titles.join(', ')}` : 'it starts now');
  }
  if (choices.length === 0) return [];
  return ['', `The human chose: ${choices.join('; ')}.`];
}

function isChosenAnswer(task: Task) {
  return !task.auto.shape && resolveTaskShape(task) === 'answer';
}

function describeDecisions(waitsOn: ChoicesQuestion, asks: TriageAsks) {
  const whys = listWhyKeys(asks);
  return [
    describeDecisionQuestion('size', SIZE_QUESTION),
    ...(asks.shape ? [describeDecisionQuestion('shape', SHAPE_QUESTION)] : []),
    ...(asks.priority ? [describeDecisionQuestion('priority', PRIORITY_QUESTION)] : []),
    ...(asks.start ? [describeDecisionQuestion('waits_on', waitsOn)] : []),
    ...(whys.length > 0 ? [`Then say why for each, in one plain sentence: ${whys.join(', ')}.`] : []),
  ];
}

export type TriageResolver = (
  state: ShinsaState,
  task: Task,
  local: LocalRepo[]
) => Promise<TriageResult | null>;

interface TriagePlan {
  task: Task;
  asks: TriageAsks;
  pool: CandidatePool;
  candidates: LocalRepo[];
  optional: boolean;
  open: Task[];
  waitsOnQuestion: ChoicesQuestion;
  fallback: TriageResult;
}

function listOpenTasks(state: ShinsaState, task: Task, project: Project | null) {
  return Object.values(state.tasks).filter(
    (candidate) =>
      candidate.id !== task.id &&
      !isTaskSettled(candidate) &&
      (!project || resolveTaskProject(state, candidate) === project.id)
  );
}

function resolveTriagePlan(state: ShinsaState, task: Task, local: LocalRepo[]): TriagePlan {
  const pinned = task.repoId ? state.repos[task.repoId] : undefined;
  const pool = resolveCandidatePool(state, task, local);
  const offered = listOfferedRepos(pool);
  const bound = pinned
    ? { path: pinned.path, name: pinned.name, touchedAt: 0 }
    : resolveContainingRepo(task.origin, offered);
  const candidates = bound ? [bound] : offered;
  const asks = resolveAsks(task);
  const size = resolveFallbackSize(task);
  const title = resolveRoundTitle(task.request).slice(0, TITLE_LIMIT).trim() || 'Untitled task';
  const open = listOpenTasks(state, task, pool.project);
  return {
    task,
    asks,
    pool,
    candidates,
    optional: !pinned,
    open,
    waitsOnQuestion: resolveWaitsOnQuestion(open),
    fallback: {
      title,
      repoPath: bound?.path ?? null,
      size,
      branch: `${size === 'large' ? 'feat' : 'fix'}/${slugify(title)}`,
      waitsOn: [],
      shape: resolveTaskShape(task),
      priority: task.priority,
      reasons: resolveFallbackReasons(task, asks),
    },
  };
}

function describeTriagePrompt(state: ShinsaState, plan: TriagePlan) {
  const { task, open } = plan;
  return [
    'Open tasks (not finished yet), each with its repository and stage:',
    ...open.map((candidate) => describeOpenTask(state, candidate)),
    open.length === 0 ? '(none)' : '',
    '',
    ...describeProject(plan.pool),
    ...describeRepoCandidates(plan.candidates),
    '',
    'Request:',
    task.request,
    ...(isChosenAnswer(task) ? ['', QUESTION_NOTE] : []),
    ...describeHumanChoices(state, task),
    '',
    'Decisions:',
    ...describeDecisions(plan.waitsOnQuestion, plan.asks),
  ].join('\n');
}

function isDependencyAllowed(state: ShinsaState, plan: TriagePlan, candidate: Task, repoPath: string | null) {
  if (plan.pool.project || candidate.repoId === null) return true;
  return state.repos[candidate.repoId]?.path === repoPath;
}

function parseWaitsOn(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer, repoPath: string | null) {
  if (!plan.asks.start) return { waitsOn: [], kept: null };
  const named = parseDecisionAnswer(plan.waitsOnQuestion, answer.waits_on);
  if (named === null) return { waitsOn: [], kept: null };
  const waitsOn = plan.open.filter(
    (candidate) => named.includes(candidate.id) && isDependencyAllowed(state, plan, candidate, repoPath)
  );
  return { waitsOn, kept: { waitsOn, dropped: waitsOn.length < named.length } };
}

function parseTriageAnswer(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer): TriageResult {
  const { asks, fallback } = plan;
  const answered = parseRepoAnswer(plan.candidates, answer.repo, plan.optional);
  const repoPath = answered === undefined ? fallback.repoPath : answered;
  const branch =
    typeof answer.branch === 'string' && BRANCH_PATTERN.test(answer.branch) ? answer.branch : null;
  const { waitsOn, kept } = parseWaitsOn(state, plan, answer, repoPath);
  const shape = asks.shape ? (parseDecisionAnswer(SHAPE_QUESTION, answer.shape) as TaskShape | null) : null;
  const priority = asks.priority
    ? (parseDecisionAnswer(PRIORITY_QUESTION, answer.priority) as TaskPriority | null)
    : null;
  const large = parseDecisionAnswer(SIZE_QUESTION, answer.size) === 'large' || fallback.size === 'large';
  return {
    title: parseAnswerText(answer.title, TITLE_LIMIT) ?? fallback.title,
    repoPath,
    size: large ? 'large' : 'small',
    branch: branch ?? fallback.branch,
    waitsOn,
    shape: shape ?? fallback.shape,
    priority: priority ?? plan.task.priority,
    reasons: resolveAnswerReasons(answer, fallback.reasons ?? {}, asks, { shape, priority, waitsOn: kept }),
  };
}

export async function resolveTriage(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson
): Promise<TriageResult> {
  const plan = resolveTriagePlan(state, task, local);
  const answer = await ask<TriageAnswer>(
    TRIAGE_SYSTEM,
    describeTriagePrompt(state, plan),
    resolveTriageSchema(plan)
  );
  if (!answer) return plan.fallback;
  return parseTriageAnswer(state, plan, answer);
}
