import {
  COMPOSABLE_STEPS,
  type DeliveringStep,
  PROPOSAL_RECOMMENDATIONS,
  SCHEDULE_LIMITS,
  SHAPE_LIMITS,
  STEP_SCHEMA,
} from '@shinsa/core';
import { limitedText } from '../fields.ts';
import { ACTIONS_SPEC, REPLY_SPEC } from '../reply.ts';
import type { ToolSpec } from '../schema.ts';

const L = SHAPE_LIMITS;

const STEP_CATALOG = COMPOSABLE_STEPS.map(
  (step) => `- \`${step}\` (${STEP_SCHEMA[step].title}): ${STEP_SCHEMA[step].exit}`
).join('\n');

const PROPOSE_CHANGE_SPEC = {
  type: 'object',
  description:
    'Only when what you found calls for a code change. The human decides whether the task turns into that change; nothing changes until they approve.',
  properties: {
    request: limitedText(
      'What to change and where, in a few sentences, as the human would ask for it.',
      L.request
    ),
    why: limitedText('Why it is worth doing, in one sentence.', L.why),
  },
  required: ['request', 'why'],
};

const RECOMMEND_SPEC = {
  type: 'string',
  enum: [...PROPOSAL_RECOMMENDATIONS],
  description:
    'What the human should do next. go_on: the work after this is worth doing, or your propose_change is. close: you found nothing worth changing, so the human sees Close as the main choice and can still go on. Required when the human decides next whether the work goes on; never close with propose_change.',
};

const AS_YOUR_REPLY =
  'Write it to the human in the first person: it is your reply, shown in the chat as you wrote it. After the call, stop and write nothing more.';

export const SHAPE_TOOL_SPECS = {
  answer: {
    name: 'answer',
    description: `Hand the human your answer. ${AS_YOUR_REPLY} Lead with the answer itself, then the evidence: files and lines as shinsa:// links.`,
    inputSchema: {
      type: 'object',
      properties: {
        answer: limitedText('The answer in markdown.', L.answer),
        reply: REPLY_SPEC,
        actions: ACTIONS_SPEC,
        propose_change: PROPOSE_CHANGE_SPEC,
        recommend: RECOMMEND_SPEC,
      },
      required: ['answer'],
    },
  },
  report_diagnosis: {
    name: 'report_diagnosis',
    description: `Hand the human your diagnosis. ${AS_YOUR_REPLY} Lead with the cause, then the evidence: files and lines as shinsa:// links. Your edits in the worktree are thrown away; only the diagnosis is kept.`,
    inputSchema: {
      type: 'object',
      properties: {
        diagnosis: limitedText(
          'The cause, or what you ruled out, and the evidence, in markdown.',
          L.diagnosis
        ),
        reply: REPLY_SPEC,
        actions: ACTIONS_SPEC,
        propose_change: PROPOSE_CHANGE_SPEC,
        recommend: RECOMMEND_SPEC,
      },
      required: ['diagnosis'],
    },
  },
  submit_report: {
    name: 'submit_report',
    description: `Hand the human your report. ${AS_YOUR_REPLY} Lead with the conclusion, then the options and the evidence behind it.`,
    inputSchema: {
      type: 'object',
      properties: {
        report: limitedText('The report in markdown.', L.report),
        reply: REPLY_SPEC,
        actions: ACTIONS_SPEC,
        propose_change: PROPOSE_CHANGE_SPEC,
        recommend: RECOMMEND_SPEC,
      },
      required: ['report'],
    },
  },
  report_outcome: {
    name: 'report_outcome',
    description: `Hand the human the outcome of the operation. ${AS_YOUR_REPLY} The task finishes with it; nothing is pushed and no pull request is opened.`,
    inputSchema: {
      type: 'object',
      properties: {
        outcome: limitedText(
          'What ran, what changed, and anything left to do or undo, in markdown.',
          L.outcome
        ),
        reply: REPLY_SPEC,
        actions: ACTIONS_SPEC,
      },
      required: ['outcome'],
    },
  },
  report_read: {
    name: 'report_read',
    description:
      'End a read of a data source, for an automation or a watchdog, then stop without restating it: what you read, the tasks you filed with `file_report` and what you skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'What you read, what you filed and what you skipped, with the counts and the numbers.',
          SCHEDULE_LIMITS.readSummary
        ),
        reached: {
          type: 'boolean',
          description: `False when the source still failed after ${SCHEDULE_LIMITS.readAttempts} tries, so the next read covers this one's time again. True when left out.`,
        },
        live: {
          type: 'boolean',
          description:
            'For a watchdog check. False when the change is not live in production, not deployed yet or rolled back: the watchdog then waits for production. True once it is live there, which a watchdog waiting for production needs (then also check it). Left out on a watching check, the change counts as live.',
        },
      },
      required: ['summary'],
    },
  },
  reshape_task: {
    name: 'reshape_task',
    description:
      'Use this instead of a plan when the steps Shinsa guessed do not fit the request: give `shape` to make it an answer, an investigation or research, or `steps` to compose the task from the building blocks. Shinsa checks the steps and tells you what to fix; once they pass, stop and Shinsa starts the first new step.',
    inputSchema: {
      type: 'object',
      properties: {
        shape: {
          type: 'string',
          enum: ['answer', 'investigate', 'research'],
          description:
            'answer: a question answered from the code. investigate: find the cause of a problem and report it. research: compare options or research a topic and write a report.',
        },
        steps: {
          type: 'array',
          minItems: 1,
          maxItems: COMPOSABLE_STEPS.length,
          items: { type: 'string', enum: [...COMPOSABLE_STEPS] },
          description: `The steps in order, from these building blocks, each with what ends it:\n${STEP_CATALOG}\nYou cannot add steps or gates: you compose these, and set the plan's parameters in \`propose_plan\`. Shinsa checks the steps against its rules and returns every problem.`,
        },
        reason: limitedText('Why the task takes these steps, in one sentence.', L.reason),
      },
      required: ['reason'],
    },
  },
} satisfies Record<string, ToolSpec>;

export const DELIVERING_TOOLS = new Map<string, DeliveringStep>([
  ['answer', 'answer'],
  ['report_diagnosis', 'investigate'],
  ['submit_report', 'research'],
  ['report_outcome', 'operate'],
]);

export const UNCHANGED_SHAPE = 'Those are the steps this task already has. Plan it with `propose_plan`.';
