import {
  PROTOCOL_LIMITS,
  type ShinsaCommand,
  type ShinsaEvent,
  validateSuggestions,
  validateWait,
} from '@shinsa/core';
import { assertProtocol } from '../handover.ts';
import { limitedText, type ToolSpec } from './schema.ts';
import { handleShapeTool } from './shapes.ts';

const L = PROTOCOL_LIMITS;

function minutes(description: string, maximum: number) {
  return { type: 'integer', minimum: 1, maximum, description };
}

export const CHANGE_SUMMARY_SPEC = limitedText(
  'Only when revising a plan: what you changed since the last version and why.',
  L.changeSummary
);

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
      'When your step depends on something outside the repository that is not ready yet (a deploy, a CI run, a service), schedule a later check instead of sleeping or polling, then end your turn. At the check time Shinsa resumes your session with your notes. If the timeout passes first, or you call it again once your checks are used up, your step ends and the human decides what happens next.',
    inputSchema: {
      type: 'object',
      properties: {
        check_in_minutes: minutes('Minutes until the next check.', L.waitCheckMinutes),
        notes: limitedText(
          'What you are waiting for and how to tell it is ready. Shinsa gives it back to you at every check.',
          L.waitNotes
        ),
        timeout_minutes: minutes(
          'Give up after this many minutes from now. Defaults to a day.',
          L.waitTimeoutMinutes
        ),
        max_attempts: {
          type: 'integer',
          minimum: 1,
          maximum: L.waitAttempts,
          description: 'The most checks to make. Defaults to 10.',
        },
      },
      required: ['check_in_minutes', 'notes'],
    },
  },
  suggest_tasks: {
    name: 'suggest_tasks',
    description:
      'Propose follow-up work you noticed that is outside this task. Each becomes a suggestion the human can accept into the roadmap or dismiss; nothing starts until they accept. Do not suggest work this task already covers. When the human asked in this chat for something that does not belong in this task, suggest it with `split_off`: they can make it a task of its own or keep it here as the next round.',
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
              title: limitedText('The follow-up in a few words.', L.suggestionTitle),
              request: limitedText(
                'The request as the human would write it: what to change and where.',
                L.suggestionRequest
              ),
              why: limitedText('Why it is worth doing, in one sentence.', L.suggestionWhy),
              after_this: {
                type: 'boolean',
                description:
                  'True when it should wait until this task is merged, for example because it builds on it.',
              },
              split_off: {
                type: 'boolean',
                description:
                  'True when the human asked for it in this task and it belongs in a task of its own instead.',
              },
            },
            required: ['title', 'request', 'why'],
          },
        },
      },
      required: ['tasks'],
    },
  },
} satisfies Record<string, ToolSpec>;

export interface ProcessToolCall {
  runId: string;
  attemptId: string;
  dispatch: (command: ShinsaCommand) => Promise<ShinsaEvent[]>;
}

function hasRunOut(events: ShinsaEvent[]) {
  return events.some((event) => event.type === 'monitor.ended' && event.status === 'exhausted');
}

function describeWait(count: number) {
  return count === 1 ? 'a minute' : `${count} minutes`;
}

export async function handleProcessTool(name: string, input: Record<string, unknown>, call: ProcessToolCall) {
  const { runId, attemptId } = call;
  switch (name) {
    case 'wait_for': {
      const wait = assertProtocol(validateWait(input));
      const events = await call.dispatch({ type: 'agent.wait_for', runId, attemptId, ...wait });
      if (hasRunOut(events))
        return 'Your wait ran out, so Shinsa asked the human what to do. End your turn now.';
      return `Shinsa will resume your session in ${describeWait(wait.checkInMinutes)} with your notes. End your turn now.`;
    }
    case 'suggest_tasks': {
      const suggestions = assertProtocol(validateSuggestions(input));
      await call.dispatch({ type: 'agent.suggest_tasks', runId, attemptId, suggestions });
      return 'Suggested. The human decides whether to add them. Carry on with your step.';
    }
    default:
      return handleShapeTool(name, input, call);
  }
}
