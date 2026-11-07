import {
  type DomainError,
  FEEDBACK_LIMITS,
  FEEDBACK_REPOSITORY,
  MEMORY_LIMITS,
  MEMORY_SCOPES,
  PROTOCOL_LIMITS,
  type ShinsaCommand,
  type ShinsaEvent,
} from '@shinsa/core';
import type { Effect } from 'effect';
import { limitedText } from '../fields.ts';
import type { ToolCallFailed, ToolSpec } from '../schema.ts';

const L = PROTOCOL_LIMITS;

export const CHOICES_SPEC = {
  choices: {
    type: 'array',
    description: `When the answer is one of a few options, 2 to ${L.options} of them. The human picks one with a click or writes their own.`,
    maxItems: L.options,
    items: { type: 'string', maxLength: L.option },
  },
  recommendation: limitedText('The choice you recommend, worded exactly as in choices.', L.option),
};

export const PROCESS_TOOL_SPECS = {
  wait_for: {
    name: 'wait_for',
    description:
      'When your step depends on something outside the repository that is not ready yet (a deploy, a CI run, a service), schedule a later check-in instead of sleeping or polling, then stop. At the check-in Shinsa resumes your session with your notes. If the timeout passes first, or you call it again once your check-ins are used up, your step ends and the human decides what happens next.',
    inputSchema: {
      type: 'object',
      properties: {
        check_in_minutes: {
          type: 'integer',
          minimum: 1,
          maximum: L.waitCheckMinutes,
          description: 'Minutes until the next check-in.',
        },
        notes: limitedText(
          'What you are waiting for and how to tell it is ready. Shinsa gives it back to you at every check-in.',
          L.waitNotes
        ),
        timeout_minutes: {
          type: 'integer',
          minimum: 1,
          maximum: L.waitTimeoutMinutes,
          description: 'Give up after this many minutes from now. Defaults to a day.',
        },
        max_attempts: {
          type: 'integer',
          minimum: 1,
          maximum: L.waitAttempts,
          description: 'The most check-ins to make. Defaults to 10.',
        },
      },
      required: ['check_in_minutes', 'notes'],
    },
  },
  suggest_tasks: {
    name: 'suggest_tasks',
    description:
      'Suggest tasks for work you noticed yourself that serves a different goal than this task. Each becomes a suggested task the human can add or dismiss; nothing starts until they accept. Suggest rarely. Work this task needs to be done well, a fix you found on the way, or anything the human asks for about this task is not a suggestion: do it here. Never answer the human’s feedback with a suggestion. Set `stack_on_this` when the work builds on this task’s code and should ship with it, as the next piece of a bundle; `after_this` when it is worth merging on its own but needs this change merged first; neither when it stands alone. Use `split_off` only when the human plainly asked in this chat for work toward another goal.',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: L.suggestions,
          items: {
            type: 'object',
            properties: {
              title: limitedText('The task in a few words.', L.suggestionTitle),
              request: limitedText(
                'The request as the human would write it: what to change and where.',
                L.suggestionRequest
              ),
              why: limitedText('Why it is worth doing, in one sentence.', L.suggestionWhy),
              after_this: {
                type: 'boolean',
                description:
                  'True when it is worth merging on its own but needs this change merged first. Never with stack_on_this.',
              },
              stack_on_this: {
                type: 'boolean',
                description:
                  'True when it builds on this task’s code and should merge together with it: it starts once this task is ready to merge, branches off this task’s branch, and the two merge as one bundle. Only when this task opens a pull request.',
              },
              split_off: {
                type: 'boolean',
                description:
                  'True only when the human plainly asked in this chat for work toward another goal, which belongs in a task of its own. Work they asked for about this task is done here.',
              },
            },
            required: ['title', 'request', 'why'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  remember: {
    name: 'remember',
    description:
      'Propose a rule every later agent should follow, when the human corrected you or said "always" or "never" in this task. The human keeps or dismisses it; nothing changes until they keep it. Only what the code cannot show you: their taste, their limits, how they want things written. Never a fact about the code or the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: [...MEMORY_SCOPES],
          description: 'global: for every project. project: only for the project this task belongs to.',
        },
        text: limitedText(
          'The rule as one short instruction to an agent, such as "Keep plans to three phases or fewer."',
          MEMORY_LIMITS.text
        ),
        why: limitedText('What the human said that it comes from, in one sentence.', MEMORY_LIMITS.why),
      },
      required: ['scope', 'text', 'why'],
    },
  },
  report_feedback: {
    name: 'report_feedback',
    description: `Report a problem with Shinsa itself, when it got in your way: a tool that refused what it should take, a limit or a rule that blocked sound work, a step that made no sense, a missing tool. Never about the task, its code or the human's own tools. Your agent rewrites it as a public GitHub issue on ${FEEDBACK_REPOSITORY} without anything private, and it opens only when the human reads it and opens it. At most ${FEEDBACK_LIMITS.perTask} per task.`,
    inputSchema: {
      type: 'object',
      properties: {
        feedback: limitedText(
          'In detail: the Shinsa tool, step, gate or screen involved, what you called or did, exactly what Shinsa did or answered, what you expected instead, and what it blocked. Name Shinsa’s own parts precisely; leave out the task’s names, paths, code and anything private.',
          FEEDBACK_LIMITS.note
        ),
      },
      required: ['feedback'],
    },
  },
} satisfies Record<string, ToolSpec>;

export interface ProcessToolCall {
  readonly runId: string;
  readonly attemptId: string;
  readonly dispatch: (command: ShinsaCommand) => Effect.Effect<ShinsaEvent[], ToolCallFailed | DomainError>;
}
