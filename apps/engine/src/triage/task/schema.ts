import { TASK_PRIORITIES, type Task, type TaskPriority, type TaskShape } from '@shinsa/core';
import { Context, type Effect } from 'effect';
import type { ChoiceQuestion, ChoicesQuestion } from '../../agents/quick/decide.ts';
import { COMMIT_TYPES } from '../../git/index.ts';
import type { LocalRepo } from '../../repos/index.ts';
import { type CandidatePool, NO_REPOSITORY, REPOSITORY_RULE, type TriageResult } from '../schema.ts';
import type { TeammateCheck, TeamReading } from '../team.ts';

export interface TriageAnswer {
  title?: unknown;
  repo?: unknown;
  new_repo?: unknown;
  size?: unknown;
  branch?: unknown;
  waits_on?: unknown;
  waits_on_kind?: unknown;
  shape?: unknown;
  priority?: unknown;
  shape_why?: unknown;
  priority_why?: unknown;
  waits_on_why?: unknown;
  duplicate_of?: unknown;
  duplicate_why?: unknown;
}

export interface TriageAsks {
  shape: boolean;
  priority: boolean;
  start: boolean;
  why: boolean;
}

export interface KeptDependencies {
  waitsOn: Task[];
  dropped: boolean;
}

export interface ParsedDecisions {
  shape: TaskShape | null;
  priority: TaskPriority | null;
  waitsOn: KeptDependencies | null;
}

export interface TriagePlan {
  task: Task;
  asks: TriageAsks;
  pool: CandidatePool;
  candidates: LocalRepo[];
  optional: boolean;
  open: Task[];
  waitsOnQuestion: ChoicesQuestion;
  duplicateQuestion: ChoiceQuestion | null;
  teammates: TeammateCheck | null;
  fallback: TriageResult;
}

export const TriageTeam = Context.Reference<Effect.Effect<TeamReading> | null>(
  'shinsa/engine/triage/task/TriageTeam',
  { defaultValue: () => null }
);

export const WHY_LIMIT = 120;

export const TITLE_LIMIT = 60;

export const NEW_REPO_LIMIT = 100;

export const TRIAGE_SYSTEM = [
  'You route a request to a repository on the developer’s machine, or to none, and size it.',
  'Return {"title": string, "repo": string, "branch": string} and one field for each decision listed after the request.',
  `title: what will be done, imperative, sentence case, at most ${TITLE_LIMIT} characters, no trailing period.`,
  `repo: the exact name of the repository the work belongs in, or "${NO_REPOSITORY}".`,
  `Answer "${NO_REPOSITORY}" when the request needs no repository: a greeting, small talk, a general question, a question about the state Shinsa keeps (its tasks, projects or settings, or what it knows) rather than code, a request to set up a Shinsa automation (a schedule, a trigger or a watch of an integration such as “watch #feedback for bugs, hourly”) rather than code such as a cron job in a repository, or planning that names no code.`,
  REPOSITORY_RULE,
  `new_repo: "" unless the request asks to start a new repository or project that is not listed (for example “start a new app called native-islands”); then the new repository’s folder name, short kebab-case, and repo is "${NO_REPOSITORY}". Never for a repository that is listed or one the request only mentions.`,
  `branch: <type>/<short-kebab-slug>, type one of ${COMMIT_TYPES.join(', ')}, the conventional commit type of the work.`,
  'The decisions: answer each only with its options.',
  `Each field ending in _why says in one plain sentence of at most ${WHY_LIMIT} characters why you answered its decision that way.`,
].join('\n');

export const QUESTION_NOTE =
  'This request is a question to answer from the code, not work to do. Title it by what it asks about, as a short phrase (for example “How the export sizes its chunks”).';

export const LARGE_HINT =
  /\b(rework|redesign|rewrite|migrate|architecture|new feature|build out|overhaul|refactor the|spec)\b/i;

export const SIZE_QUESTION: ChoiceQuestion = {
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

export const PRIORITY_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'How soon does this need doing, next to the other work?',
  criteria: Object.fromEntries(TASK_PRIORITIES.map((priority) => [priority, PRIORITY_MEANINGS[priority]])),
};

export const SHAPE_NOUN: Record<TaskShape, string> = {
  answer: 'a question',
  investigate: 'an investigation',
  research: 'research',
  change: 'a change',
  fix: 'a fix',
  operation: 'an operation',
};

export const UNCLASSIFIED = 'Shinsa could not classify the request, so';

export const NOT_A_DUPLICATE = 'none';

export const NO_WAIT = 'none';

export const WAITS_ON_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: `Which direct dependency makes this task wait on the tasks in waits_on? "${NO_WAIT}" when waits_on is empty; a wait without one of the other kinds is dropped.`,
  criteria: {
    [NO_WAIT]: 'it waits on no task',
    needs_its_code:
      'it edits or calls code that exists only on that task’s unmerged branch, so it cannot be built against the default branch',
    asked_for: 'the request itself asks for this task to come after that one',
    shared_rewrite:
      'both tasks heavily rewrite the same files, as in a rewrite or migration of shared code, so building them side by side would surely conflict',
  },
};
