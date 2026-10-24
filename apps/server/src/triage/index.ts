import {
  isTaskSettled,
  listProjectRepos,
  type Project,
  resolveTaskProject,
  resolveTaskShape,
  type ShinsaState,
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
import { slugify } from '../git/index.ts';
import { type LocalRepo, listLocalRepos, resolveContainingRepo } from '../repos/index.ts';
import { parseAnswerText, SHAPE_QUESTION } from './decisions.ts';

export interface TriageResult {
  title: string;
  repoPath: string;
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
  depends_on_why?: unknown;
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

const BRANCH_PATTERN = /^[a-z]+\/[a-z0-9-]+$/;

const TRIAGE_SYSTEM = [
  'You route a coding request to a repository on the developer’s machine and size it.',
  'Return {"title": string, "repo": string, "branch": string} and one field for each decision listed after the request.',
  `title: what will be done, imperative, sentence case, at most ${TITLE_LIMIT} characters, no trailing period.`,
  'repo: the exact name of the repository the work belongs in. Prefer repositories with recent Shinsa work.',
  'branch: <type>/<short-kebab-slug>, type one of feat, fix, chore, refactor, docs.',
  'The decisions: answer each only with its options.',
  `Each field ending in _why says in one plain sentence of at most ${WHY_LIMIT} characters why you answered its decision that way.`,
].join('\n');

const QUESTION_NOTE =
  'This request is a question to answer from the code, not work to do. Title it by what it asks about, as a short phrase (for example “How the export sizes its chunks”).';

const LARGE_HINT =
  /\b(rework|redesign|rewrite|migrate|architecture|new feature|build out|overhaul|refactor the|spec)\b/i;

const SIZE_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'How much agreement does the work need before building starts?',
  criteria: {
    small: 'a contained fix or change with an obvious approach',
    large: 'a new feature, a change across several areas, a UI flow, the data model, or anything ambiguous',
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

function resolveDependsOnQuestion(open: Task[]): ChoicesQuestion {
  return {
    type: 'choices',
    instructions:
      'Which open tasks must be finished before this one can start? Often none. Name a task only when this request clearly needs its work to exist first: it extends, uses or changes what that task builds. Related but independent work is left out; it runs in parallel.',
    criteria: Object.fromEntries(open.map((task) => [task.id, task.title])),
  };
}

function resolveAsks(task: Task): TriageAsks {
  if (!task.auto) return { shape: false, priority: false, start: true, why: false };
  return { ...task.auto, why: true };
}

function listWhyKeys(asks: TriageAsks) {
  if (!asks.why) return [];
  return [
    ...(asks.shape ? ['shape_why'] : []),
    ...(asks.priority ? ['priority_why'] : []),
    ...(asks.start ? ['depends_on_why'] : []),
  ];
}

function resolveTriageSchema(
  candidates: LocalRepo[],
  waitsOn: ChoicesQuestion,
  asks: TriageAsks
): JsonSchema {
  const properties: Record<string, unknown> = {
    title: { type: 'string', maxLength: TITLE_LIMIT },
    repo: { type: 'string', enum: candidates.map((candidate) => candidate.name) },
    size: resolveDecisionProperty(SIZE_QUESTION),
    branch: { type: 'string', pattern: BRANCH_PATTERN.source },
  };
  if (asks.shape) properties.shape = resolveDecisionProperty(SHAPE_QUESTION);
  if (asks.priority) properties.priority = resolveDecisionProperty(PRIORITY_QUESTION);
  if (asks.start) properties.waits_on = resolveDecisionProperty(waitsOn);
  for (const key of listWhyKeys(asks)) properties[key] = { type: 'string', maxLength: WHY_LIMIT };
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function resolveFallbackSize(task: Task): TaskSize {
  return task.planFirst || task.intent.length > 500 || LARGE_HINT.test(task.intent) ? 'large' : 'small';
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
  const why = kept.dropped ? null : parseAnswerText(answer.depends_on_why, WHY_LIMIT);
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
  empty: boolean;
}

function listCandidates(state: ShinsaState, local: LocalRepo[], registered = Object.values(state.repos)) {
  const used = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    const repo = task.repoId ? state.repos[task.repoId] : undefined;
    if (repo) used.set(repo.path, Math.max(used.get(repo.path) ?? 0, task.updatedAt));
  }
  const byPath = new Map(local.map((repo) => [repo.path, repo]));
  for (const repo of registered) {
    if (!byPath.has(repo.path)) byPath.set(repo.path, { path: repo.path, name: repo.name, touchedAt: 0 });
  }
  return [...byPath.values()].sort(
    (a, b) => (used.get(b.path) ?? 0) - (used.get(a.path) ?? 0) || b.touchedAt - a.touchedAt
  );
}

function resolveCandidatePool(state: ShinsaState, task: Task, local: LocalRepo[]): CandidatePool {
  const projectId = resolveTaskProject(state, task);
  const project = projectId ? (state.projects[projectId] ?? null) : null;
  if (!project) return { project: null, candidates: listCandidates(state, local), empty: false };
  const candidates = listCandidates(
    state,
    listLocalRepos(project.folders),
    listProjectRepos(state, project.id)
  );
  if (candidates.length > 0) return { project, candidates, empty: false };
  return { project, candidates: listCandidates(state, local), empty: true };
}

function describeProject(pool: CandidatePool) {
  if (!pool.project) return [];
  return [
    'Project:',
    `- name: ${pool.project.name}`,
    `- key: ${pool.project.key}`,
    ...(pool.project.description ? [`- description: ${pool.project.description}`] : []),
    ...(pool.empty
      ? ['The project has no repository yet, so every repository on the machine is offered.']
      : []),
    '',
  ];
}

function describeOpenTask(state: ShinsaState, task: Task) {
  const repo = state.repos[task.repoId ?? '']?.name ?? 'no repository yet';
  return `- ${task.id}: ${task.title} (${repo}, ${task.stage})`;
}

function describeHumanChoices(state: ShinsaState, task: Task) {
  if (!task.auto) return [];
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
  return !task.auto?.shape && resolveTaskShape(task) === 'answer';
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
  open: Task[];
  dependsOnQuestion: ChoicesQuestion;
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

function resolveTriagePlan(state: ShinsaState, task: Task, local: LocalRepo[]): TriagePlan | null {
  const pinned = task.repoId ? state.repos[task.repoId] : undefined;
  const pool = resolveCandidatePool(state, task, local);
  const origin = resolveContainingRepo(task.origin, pool.candidates);
  const candidates = pinned
    ? [{ path: pinned.path, name: pinned.name, touchedAt: 0 }]
    : origin
      ? [origin]
      : pool.candidates;
  const first = candidates[0];
  if (!first) return null;
  const asks = resolveAsks(task);
  const size = resolveFallbackSize(task);
  const title = task.intent.split('\n')[0]?.slice(0, TITLE_LIMIT).trim() || 'Untitled task';
  const open = listOpenTasks(state, task, pool.project);
  return {
    task,
    asks,
    pool,
    candidates,
    open,
    dependsOnQuestion: resolveDependsOnQuestion(open),
    fallback: {
      title,
      repoPath: first.path,
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
    'Repositories, most recently worked on first:',
    ...plan.candidates.map((candidate) => `- ${candidate.name}: ${candidate.path}`),
    '',
    'Request:',
    task.intent,
    ...(isChosenAnswer(task) ? ['', QUESTION_NOTE] : []),
    ...describeHumanChoices(state, task),
    '',
    'Decisions:',
    ...describeDecisions(plan.dependsOnQuestion, plan.asks),
  ].join('\n');
}

function isDependencyAllowed(state: ShinsaState, plan: TriagePlan, candidate: Task, repoPath: string) {
  if (plan.pool.project || candidate.repoId === null) return true;
  return state.repos[candidate.repoId]?.path === repoPath;
}

function parseDependsOn(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer, repoPath: string) {
  if (!plan.asks.start) return { waitsOn: [], kept: null };
  const named = parseDecisionAnswer(plan.dependsOnQuestion, answer.waits_on);
  if (named === null) return { waitsOn: [], kept: null };
  const waitsOn = plan.open.filter(
    (candidate) => named.includes(candidate.id) && isDependencyAllowed(state, plan, candidate, repoPath)
  );
  return { waitsOn, kept: { waitsOn, dropped: waitsOn.length < named.length } };
}

function parseTriageAnswer(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer): TriageResult {
  const { asks, fallback } = plan;
  const repo = plan.candidates.find((candidate) => candidate.name === answer.repo);
  const repoPath = repo?.path ?? fallback.repoPath;
  const branch =
    typeof answer.branch === 'string' && BRANCH_PATTERN.test(answer.branch) ? answer.branch : null;
  const { waitsOn, kept } = parseDependsOn(state, plan, answer, repoPath);
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
): Promise<TriageResult | null> {
  const plan = resolveTriagePlan(state, task, local);
  if (!plan) return null;
  const answer = await ask<TriageAnswer>(
    TRIAGE_SYSTEM,
    describeTriagePrompt(state, plan),
    resolveTriageSchema(plan.candidates, plan.dependsOnQuestion, plan.asks)
  );
  if (!answer) return plan.fallback;
  return parseTriageAnswer(state, plan, answer);
}
