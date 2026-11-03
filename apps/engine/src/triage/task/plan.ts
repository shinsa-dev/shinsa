import {
  isTaskSettled,
  type Project,
  quoteDuplicateOriginal,
  resolveRoundTitle,
  resolveTaskProject,
  resolveTaskShape,
  type ShinsaState,
  type Task,
  type TaskPriority,
  type TaskShape,
  type TaskSize,
  type TriageReasons,
} from '@shinsa/core';
import type { JsonSchema } from '../../agents/providers/index.ts';
import {
  type ChoiceQuestion,
  type ChoicesQuestion,
  describeDecisionQuestion,
  parseDecisionAnswer,
  resolveDecisionProperty,
} from '../../agents/quick/decide.ts';
import { BRANCH_PATTERN, slugify } from '../../git/index.ts';
import { type LocalRepo, REPOSITORY_NAME, resolveContainingRepo } from '../../repos/index.ts';
import { parseAnswerText, SHAPE_QUESTION } from '../decisions.ts';
import {
  describeProject,
  describeRepoCandidates,
  listOfferedRepos,
  parseRepoAnswer,
  resolveCandidatePool,
  resolveRepoProperty,
} from '../repositories.ts';
import type { TriageResult } from '../schema.ts';
import { resolveTeammateCheck, type TeammateCheck, type TeammateTask, type TeamReader } from '../team.ts';
import {
  type KeptDependencies,
  LARGE_HINT,
  NEW_REPO_LIMIT,
  NOT_A_DUPLICATE,
  type ParsedDecisions,
  PRIORITY_QUESTION,
  QUESTION_NOTE,
  SHAPE_NOUN,
  SIZE_QUESTION,
  TITLE_LIMIT,
  type TriageAnswer,
  type TriageAsks,
  type TriagePlan,
  UNCLASSIFIED,
  WHY_LIMIT,
} from './schema.ts';

function resolveWaitsOnQuestion(open: Task[]): ChoicesQuestion {
  return {
    type: 'choices',
    instructions:
      'Which open tasks must be finished before this one can start? Often none. Name a task only when this request clearly needs its work to exist first: it extends, uses or changes what that task builds. Related but independent work is left out; it runs in parallel.',
    criteria: Object.fromEntries(open.map((task) => [task.id, task.title])),
  };
}

function resolveDuplicateQuestion(open: Task[], teammates: TeammateTask[]): ChoiceQuestion | null {
  if (open.length === 0 && teammates.length === 0) return null;
  return {
    type: 'choice',
    instructions: `Is this request the same work as an open task, so that doing both would do the work twice? Name a task only when it would deliver the same outcome in the same repository: each task ships one pull request in its own repository, so a task in another repository is never the same work, however alike the requests read. Related, overlapping, follow-up or partly the same work is "${NOT_A_DUPLICATE}"; so is anything you are unsure of. Usually "${NOT_A_DUPLICATE}".`,
    criteria: {
      [NOT_A_DUPLICATE]: 'not the same work as any open task',
      ...Object.fromEntries(open.map((task) => [task.id, task.title])),
      ...Object.fromEntries(teammates.map((task) => [task.key, quoteDuplicateOriginal(task.original)])),
    },
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

function parseNewRepoAnswer(candidates: LocalRepo[], value: unknown) {
  if (typeof value !== 'string' || !REPOSITORY_NAME.test(value) || value.endsWith('.git')) return null;
  const listed = candidates.find((candidate) => candidate.name === value);
  return listed ? { path: listed.path } : { name: value };
}

export function resolveTriageSchema(plan: TriagePlan): JsonSchema {
  const { asks } = plan;
  const properties: Record<string, unknown> = {
    title: { type: 'string', maxLength: TITLE_LIMIT },
    repo: resolveRepoProperty(plan.candidates, plan.optional),
    ...(plan.optional
      ? {
          new_repo: {
            type: 'string',
            maxLength: NEW_REPO_LIMIT,
            pattern: `^$|${REPOSITORY_NAME.source}`,
          },
        }
      : {}),
    size: resolveDecisionProperty(SIZE_QUESTION),
    branch: { type: 'string', pattern: BRANCH_PATTERN.source },
  };
  if (asks.shape) properties.shape = resolveDecisionProperty(SHAPE_QUESTION);
  if (asks.priority) properties.priority = resolveDecisionProperty(PRIORITY_QUESTION);
  if (asks.start) properties.waits_on = resolveDecisionProperty(plan.waitsOnQuestion);
  if (plan.duplicateQuestion) {
    properties.duplicate_of = resolveDecisionProperty(plan.duplicateQuestion);
    properties.duplicate_why = { type: 'string', maxLength: WHY_LIMIT };
  }
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

function describeOpenTask(state: ShinsaState, task: Task) {
  const repo = state.repos[task.repoId ?? '']?.name ?? 'no repository yet';
  return `- ${task.id}: ${task.title} (${repo}, ${task.stage})`;
}

function describeTeammateTask(task: TeammateTask) {
  const plan = task.goal ? ` Plan: ${task.goal}` : '';
  return `- ${task.key}: ${quoteDuplicateOriginal(task.original)} (${task.repoName}, ${task.stage}). Request: ${task.request}${plan}`;
}

function describeTeammateTasks(teammates: TeammateCheck | null) {
  if (!teammates || teammates.tasks.length === 0) return [];
  return [
    '',
    'Teammates’ open tasks, on their own machines, each with its owner, repository, stage, request and plan:',
    ...teammates.tasks.map(describeTeammateTask),
  ];
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

function describeDecisions(plan: TriagePlan) {
  const { asks, duplicateQuestion } = plan;
  const whys = [...listWhyKeys(asks), ...(duplicateQuestion ? ['duplicate_why'] : [])];
  return [
    describeDecisionQuestion('size', SIZE_QUESTION),
    ...(asks.shape ? [describeDecisionQuestion('shape', SHAPE_QUESTION)] : []),
    ...(asks.priority ? [describeDecisionQuestion('priority', PRIORITY_QUESTION)] : []),
    ...(asks.start ? [describeDecisionQuestion('waits_on', plan.waitsOnQuestion)] : []),
    ...(duplicateQuestion ? [describeDecisionQuestion('duplicate_of', duplicateQuestion)] : []),
    ...(whys.length > 0 ? [`Then say why for each, in one plain sentence: ${whys.join(', ')}.`] : []),
  ];
}

function listOpenTasks(state: ShinsaState, task: Task, project: Project | null) {
  return Object.values(state.tasks).filter(
    (candidate) =>
      candidate.id !== task.id &&
      !isTaskSettled(candidate) &&
      (!project || resolveTaskProject(state, candidate) === project.id)
  );
}

export function resolveTriagePlan(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  team: TeamReader | null
): TriagePlan {
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
  const teammates = team ? resolveTeammateCheck(pool.project, team()) : null;
  return {
    task,
    asks,
    pool,
    candidates,
    optional: !pinned,
    open,
    waitsOnQuestion: resolveWaitsOnQuestion(open),
    duplicateQuestion: resolveDuplicateQuestion(open, teammates?.tasks ?? []),
    teammates,
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

export function describeTriagePrompt(state: ShinsaState, plan: TriagePlan) {
  const { task, open } = plan;
  return [
    'Open tasks (not finished yet), each with its repository and stage:',
    ...open.map((candidate) => describeOpenTask(state, candidate)),
    open.length === 0 ? '(none)' : '',
    ...describeTeammateTasks(plan.teammates),
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
    ...describeDecisions(plan),
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

function resolveDuplicateWhy(answer: TriageAnswer, quoted: string) {
  return parseAnswerText(answer.duplicate_why, WHY_LIMIT) ?? `It asks for the same work as ${quoted}.`;
}

function isDuplicateAllowed(state: ShinsaState, candidate: Task, repoPath: string | null) {
  if (repoPath === null || candidate.repoId === null) return false;
  return state.repos[candidate.repoId]?.path === repoPath;
}

function parseDuplicate(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer, repoPath: string | null) {
  if (!plan.duplicateQuestion) return null;
  const named = parseDecisionAnswer(plan.duplicateQuestion, answer.duplicate_of);
  const teammate = plan.teammates?.tasks.find((candidate) => candidate.key === named);
  if (teammate) {
    const repoName = plan.candidates.find((candidate) => candidate.path === repoPath)?.name;
    if (teammate.repoName !== repoName) return null;
    const original = { ...teammate.original };
    return {
      duplicateOfTeammate: original,
      why: resolveDuplicateWhy(answer, quoteDuplicateOriginal(original)),
    };
  }
  const original = plan.open.find((candidate) => candidate.id === named);
  if (!original || !isDuplicateAllowed(state, original, repoPath)) return null;
  return { duplicateOf: original.id, why: resolveDuplicateWhy(answer, `“${original.title}”`) };
}

export function parseTriageAnswer(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer): TriageResult {
  const { asks, fallback } = plan;
  const answered = parseRepoAnswer(plan.candidates, answer.repo, plan.optional);
  const created = answered === null ? parseNewRepoAnswer(plan.candidates, answer.new_repo) : null;
  const repoPath = created?.path ?? (answered === undefined ? fallback.repoPath : answered);
  const branch =
    typeof answer.branch === 'string' && BRANCH_PATTERN.test(answer.branch) ? answer.branch : null;
  const { waitsOn, kept } = parseWaitsOn(state, plan, answer, repoPath);
  const duplicate = parseDuplicate(state, plan, answer, repoPath);
  const shape = asks.shape ? (parseDecisionAnswer(SHAPE_QUESTION, answer.shape) as TaskShape | null) : null;
  const priority = asks.priority
    ? (parseDecisionAnswer(PRIORITY_QUESTION, answer.priority) as TaskPriority | null)
    : null;
  const large = parseDecisionAnswer(SIZE_QUESTION, answer.size) === 'large' || fallback.size === 'large';
  return {
    title: parseAnswerText(answer.title, TITLE_LIMIT) ?? fallback.title,
    repoPath,
    ...(created?.name ? { newRepo: created.name } : {}),
    size: large ? 'large' : 'small',
    branch: branch ?? fallback.branch,
    waitsOn,
    ...(duplicate?.duplicateOf ? { duplicateOf: duplicate.duplicateOf } : {}),
    ...(duplicate?.duplicateOfTeammate ? { duplicateOfTeammate: duplicate.duplicateOfTeammate } : {}),
    ...(plan.teammates ? { unreached: plan.teammates.unreached } : {}),
    shape: shape ?? fallback.shape,
    priority: priority ?? plan.task.priority,
    reasons: {
      ...resolveAnswerReasons(answer, fallback.reasons ?? {}, asks, { shape, priority, waitsOn: kept }),
      ...(duplicate ? { duplicate: duplicate.why } : {}),
    },
  };
}
