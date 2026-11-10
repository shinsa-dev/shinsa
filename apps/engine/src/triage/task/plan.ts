import {
  hasStep,
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
import { Effect, Option } from 'effect';
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
import {
  clipText,
  resolveTeammateCheck,
  type TeammateCheck,
  type TeammateTask,
  type TeamReading,
} from '../team.ts';
import {
  type KeptDependencies,
  LARGE_HINT,
  NEW_REPO_LIMIT,
  NO_STACK,
  NO_WAIT,
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
  WAITS_ON_KIND_QUESTION,
  WHY_LIMIT,
} from './schema.ts';

function resolveWaitsOnQuestion(open: Task[]): ChoicesQuestion {
  return {
    type: 'choices',
    instructions:
      'Which open tasks must be merged before this one can start? Usually none: tasks run side by side, and a wait holds this task, planning included, until the other one merges. Name a task only for a direct dependency: this request edits or calls code that exists only on that task’s unmerged branch, the request itself asks to come after it, or both heavily rewrite the same files. Never wait because the tasks share an area, a feature or words in their titles, because this one builds on something that already exists, because it is a follow-up idea, or because it would be nicer after. When in doubt, answer an empty list.',
    criteria: Object.fromEntries(open.map((task) => [task.id, task.title])),
  };
}

function listStackableTasks(open: Task[]) {
  return open.filter((task) => task.repoId !== null && hasStep(task, 'pull_request'));
}

function resolveStacksOnQuestion(open: Task[], asks: TriageAsks): ChoiceQuestion | null {
  const stackable = listStackableTasks(open);
  if (!asks.start || stackable.length === 0) return null;
  return {
    type: 'choice',
    instructions: `Is this request the next piece of an open change in the same repository, so the two should ship together as one bundle? Stacking builds this task on that task’s branch, holds that task’s merge until this one is ready too, and merges both at once. Name a task only when this request continues that change: a part split off the same larger rewrite or migration, or the next step of that task’s own work, wrong to ship without it. A separate feature is never a stack, even one that needs the other’s code: that is waits_on. Usually "${NO_STACK}".`,
    criteria: {
      [NO_STACK]: 'not part of any open change',
      ...Object.fromEntries(stackable.map((task) => [task.id, task.title])),
    },
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
  return { shape: task.auto.shape, priority: task.auto.priority, start: task.auto.start, why: true };
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
  if (asks.start) {
    properties.waits_on = resolveDecisionProperty(plan.waitsOnQuestion);
    properties.waits_on_kind = resolveDecisionProperty(WAITS_ON_KIND_QUESTION);
  }
  if (plan.stacksOnQuestion) {
    properties.stacks_on = resolveDecisionProperty(plan.stacksOnQuestion);
    properties.stacks_on_why = { type: 'string', maxLength: WHY_LIMIT };
  }
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
  const goal = task.plan?.document?.goal;
  const plan = goal ? ` Plan: ${clipText(goal)}` : '';
  return `- ${task.id}: ${task.title} (${repo}, ${task.stage}). Request: ${clipText(task.request)}${plan}`;
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
  const { asks, stacksOnQuestion, duplicateQuestion } = plan;
  const whys = [
    ...listWhyKeys(asks),
    ...(stacksOnQuestion ? ['stacks_on_why'] : []),
    ...(duplicateQuestion ? ['duplicate_why'] : []),
  ];
  return [
    describeDecisionQuestion('size', SIZE_QUESTION),
    ...(asks.shape ? [describeDecisionQuestion('shape', SHAPE_QUESTION)] : []),
    ...(asks.priority ? [describeDecisionQuestion('priority', PRIORITY_QUESTION)] : []),
    ...(asks.start
      ? [
          describeDecisionQuestion('waits_on', plan.waitsOnQuestion),
          describeDecisionQuestion('waits_on_kind', WAITS_ON_KIND_QUESTION),
        ]
      : []),
    ...(stacksOnQuestion ? [describeDecisionQuestion('stacks_on', stacksOnQuestion)] : []),
    ...(duplicateQuestion ? [describeDecisionQuestion('duplicate_of', duplicateQuestion)] : []),
    ...(whys.length > 0 ? [`Then say why for each, in one plain sentence: ${whys.join(', ')}.`] : []),
  ];
}

function listOpenTasks(state: ShinsaState, task: Task, project: Project | null) {
  return Object.values(state.tasks).filter(
    (candidate) =>
      candidate.id !== task.id &&
      !isTaskSettled(candidate) &&
      (!project || Option.getOrNull(resolveTaskProject(state, candidate)) === project.id)
  );
}

export const resolveTriagePlan = Effect.fn('TaskTriage.resolvePlan')(function* (
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  team: TeamReading | null
) {
  const pinned = task.repoId ? state.repos[task.repoId] : undefined;
  const pool = yield* resolveCandidatePool(state, task, local);
  const offered = listOfferedRepos(pool);
  const bound = pinned
    ? { path: pinned.path, name: pinned.name, touchedAt: 0 }
    : resolveContainingRepo(task.origin, offered);
  const candidates = bound ? [bound] : offered;
  const asks = resolveAsks(task);
  const size = resolveFallbackSize(task);
  const title = resolveRoundTitle(task.request).slice(0, TITLE_LIMIT).trim() || 'Untitled task';
  const open = listOpenTasks(state, task, pool.project);
  const teammates = team ? resolveTeammateCheck(pool.project, team) : null;
  return {
    task,
    asks,
    pool,
    candidates,
    optional: !pinned,
    open,
    waitsOnQuestion: resolveWaitsOnQuestion(open),
    stacksOnQuestion: resolveStacksOnQuestion(open, asks),
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
  } satisfies TriagePlan;
});

export function describeTriagePrompt(state: ShinsaState, plan: TriagePlan) {
  const { task, open } = plan;
  return [
    'Open tasks (not finished yet), each with its repository, stage, request and plan:',
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
  const kind = parseDecisionAnswer(WAITS_ON_KIND_QUESTION, answer.waits_on_kind);
  if (named.length > 0 && (kind === null || kind === NO_WAIT)) {
    return { waitsOn: [], kept: { waitsOn: [], dropped: true } };
  }
  const waitsOn = plan.open.filter(
    (candidate) => named.includes(candidate.id) && isDependencyAllowed(state, plan, candidate, repoPath)
  );
  return { waitsOn, kept: { waitsOn, dropped: waitsOn.length < named.length } };
}

function parseStacksOn(state: ShinsaState, plan: TriagePlan, answer: TriageAnswer, repoPath: string | null) {
  if (!plan.stacksOnQuestion || repoPath === null) return null;
  const named = parseDecisionAnswer(plan.stacksOnQuestion, answer.stacks_on);
  const parent = listStackableTasks(plan.open).find((candidate) => candidate.id === named);
  if (!parent || state.repos[parent.repoId ?? '']?.path !== repoPath) return null;
  const why =
    parseAnswerText(answer.stacks_on_why, WHY_LIMIT) ?? `It continues “${parent.title}” and ships with it.`;
  return { parent, why };
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
  const stack = parseStacksOn(state, plan, answer, repoPath);
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
    ...(stack ? { stacksOn: [stack.parent] } : {}),
    ...(duplicate?.duplicateOf ? { duplicateOf: duplicate.duplicateOf } : {}),
    ...(duplicate?.duplicateOfTeammate ? { duplicateOfTeammate: duplicate.duplicateOfTeammate } : {}),
    ...(plan.teammates ? { unreached: plan.teammates.unreached } : {}),
    shape: shape ?? fallback.shape,
    priority: priority ?? plan.task.priority,
    reasons: {
      ...resolveAnswerReasons(answer, fallback.reasons ?? {}, asks, { shape, priority, waitsOn: kept }),
      ...(stack && asks.why ? { stack: stack.why } : {}),
      ...(duplicate ? { duplicate: duplicate.why } : {}),
    },
  };
}
