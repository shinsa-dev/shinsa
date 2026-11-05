import { ROUND_LIMITS, type RoundStatus, type Task } from '@shinsa/core';
import type { JsonSchema } from '../../agents/providers/index.ts';
import { type ChoiceQuestion, resolveDecisionProperty } from '../../agents/quick/decide.ts';
import { SHAPE_QUESTION } from '../decisions.ts';
import { NO_REPOSITORY, REPOSITORY_RULE } from '../schema.ts';

export interface MessageAnswer {
  kind?: unknown;
  shape?: unknown;
  title?: unknown;
  why?: unknown;
}

export const MESSAGE_SYSTEM = [
  'You read one message a developer wrote in the chat of a coding task and decide what it asks for.',
  'A task is a conversation that runs in rounds. Each round is one piece of work: an answer, research, an investigation, an operation, or a code change shipped as a pull request. New work for the same goal becomes the next round.',
  'Most messages need no new work. Thanks, an acknowledgement or small talk needs nothing, and a question, or a request to check, confirm, verify or look into what a round did (its deploy, its logs, its live data), is answered in that round. Only a message that asks for a new change or operation that has not been done is new work.',
  'Return one JSON object with the decisions listed after the message.',
  `why: one plain sentence of at most ${ROUND_LIMITS.why} characters saying what the message asks for, and so why you decided that. Write it first.`,
  `title: what the new work does, imperative, sentence case, at most ${ROUND_LIMITS.title} characters, no trailing period; for anything else, what the message is about.`,
].join('\n');

export const ACKNOWLEDGE =
  'needs nothing: thanks, an acknowledgement ("ok", "great", "sick thank you"), praise or small talk';

export const SEPARATE_TASK =
  "plainly asks for work toward another goal, unrelated to this task, which belongs in a task of its own; a message about this task's own work, its files, its steps, the parts it needs in other repositories or a change to how it behaves is not this, even when it names another repository or checkout; when unsure, it is not this";

export const RESTING_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Nothing is in progress in this task. What is this message?',
  criteria: {
    acknowledge: ACKNOWLEDGE,
    feedback:
      'a question about what the last round did, found or decided ("why did you pick X?", "where did Y go?"), a request to check, confirm or verify it ("is it live?", "confirm it worked"), or about one of the steps left for the human after the merge, even one that quotes the step ("what is this for? <the step>"), answered from the work already done; nothing new is changed',
    new_round:
      'asks for new work in this task: a change to the code, the next step that changes something (such as opening a pull request), an operation to run, or a change to what the last round did, even a small correction ("actually do Z instead"); checking, confirming or looking into finished work is not this, and neither is a step left for the human after the merge, quoted or asked about, since the human does it',
    separate_task: SEPARATE_TASK,
  },
};

export const POST_MERGE_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions:
    'The work of this task merged, and steps the human does after the merge (listed above) are still open. Nothing else is in progress. What is this message?',
  criteria: {
    acknowledge: ACKNOWLEDGE,
    feedback:
      'about the merged work and its steps after the merge: how to deploy it or do a step, confirming or verifying a deploy (even with pasted command output), whether it is live, monitoring it, reading its logs, traces or live data ("have purchases worked since?"), something to run or check for it, or any question; answered in this round, nothing new is changed',
    new_round:
      'a new code change or operation of its own: changing how the merged work behaves, a fix to it or a new idea, not something needed to deploy, check or finish this round',
    separate_task: SEPARATE_TASK,
  },
};

export const WORKING_KIND_QUESTION: ChoiceQuestion = {
  type: 'choice',
  instructions: 'A round of this task is in progress. What is this message?',
  criteria: {
    acknowledge: ACKNOWLEDGE,
    feedback:
      'about the work of the current round: a correction, an answer, guidance, a nudge or a question about what it does, including its files, its steps around the merge and what it needs in other repositories',
    new_round:
      'new work for this task that the current round does not cover: a new idea, an extension or the next step of the same goal',
    separate_task: SEPARATE_TASK,
  },
};

export const GATE_STAGES: Partial<Record<Task['stage'], string>> = {
  awaiting_review: 'review',
  awaiting_merge: 'merge',
};

export const MESSAGE_SHAPE_QUESTION: ChoiceQuestion = {
  ...SHAPE_QUESTION,
  instructions:
    'For new work (new_round or separate_task): what kind of task is it? Read the message as the request of a new task, with the rounds above as its context; a question about the code is an answer, not a change. For acknowledge or feedback answer "answer"; it is not used.',
};

export const ROUND_SHAPE_SYSTEM = [
  'You read the request for the next round of a coding task and decide what kind of work it is.',
  'A task is a conversation that runs in rounds. Each round is one piece of work: an answer, research, an investigation, an operation, or a code change shipped as a pull request.',
  'Return one JSON object with the decision listed after the request.',
].join('\n');

export const ROUND_SHAPE_QUESTION: ChoiceQuestion = {
  ...SHAPE_QUESTION,
  instructions:
    'What kind of task is this round? Read the request as the request of a new task, with the rounds above as its context; a question about the code is an answer, not a change.',
};

export const ROUND_SHAPE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { shape: resolveDecisionProperty(ROUND_SHAPE_QUESTION) },
  required: ['shape'],
  additionalProperties: false,
};

export const REPOSITORY_SYSTEM = [
  'You read what the current round of a coding task asks for and decide which repository on the developer’s machine its work happens in.',
  'The task has no repository yet, and this round’s work needs one: it changes code, investigates a problem or runs an operation.',
  `Return {"repo": string}: the exact name of one repository listed, or "${NO_REPOSITORY}".`,
  `Answer "${NO_REPOSITORY}" when nothing in the request, the change agreed to or the messages names a repository or clearly needs the code of one listed; the human is then asked which one.`,
  REPOSITORY_RULE,
].join('\n');

export const ROUND_STATE: Record<RoundStatus, string> = {
  waiting: 'waiting',
  active: 'in progress',
  shipped: 'pull request open',
  merged: 'merged',
  finished: 'finished',
  cancelled: 'stopped',
};

export const RESULT_EXCERPT = 400;

export const STEP_EXCERPT = 200;
