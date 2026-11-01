import {
  FEEDBACK_LIMITS,
  FEEDBACK_REPOSITORY,
  MEMORY_LIMITS,
  MEMORY_SCOPES,
  PROTOCOL_LIMITS,
  type ShinsaCommand,
  type ShinsaEvent,
  validateFeedbackReport,
  validateMemoryProposal,
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
        check_in_minutes: minutes('Minutes until the next check-in.', L.waitCheckMinutes),
        notes: limitedText(
          'What you are waiting for and how to tell it is ready. Shinsa gives it back to you at every check-in.',
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
          description: 'The most check-ins to make. Defaults to 10.',
        },
      },
      required: ['check_in_minutes', 'notes'],
    },
  },
  suggest_tasks: {
    name: 'suggest_tasks',
    description:
      'Suggest tasks for work you noticed that is outside this task. Each becomes a suggested task the human can add as a task or dismiss; nothing starts until they accept. Do not suggest work this task already covers. When the human asked in this chat for something that does not belong in this task, suggest it with `split_off`: they can make it a task of its own or keep it here as the next round.',
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
        return 'Your wait ran out, so Shinsa asked the human what to do. Stop here without a closing message.';
      return `Shinsa will resume your session in ${describeWait(wait.checkInMinutes)} with your notes. Stop here without a closing message.`;
    }
    case 'suggest_tasks': {
      const suggestions = assertProtocol(validateSuggestions(input));
      await call.dispatch({ type: 'agent.suggest_tasks', runId, attemptId, suggestions });
      return 'Suggested. The human decides whether to add them. Carry on with your step.';
    }
    case 'remember': {
      const rule = assertProtocol(validateMemoryProposal(input));
      await call.dispatch({ type: 'agent.remember', runId, attemptId, ...rule });
      return 'Proposed. The human decides whether agents remember it. Carry on with your step.';
    }
    case 'report_feedback': {
      const report = assertProtocol(validateFeedbackReport(input));
      await call.dispatch({ type: 'agent.report_feedback', runId, attemptId, ...report });
      return 'Reported. The human reads it before it becomes a public issue. Carry on with your step.';
    }
    default:
      return handleShapeTool(name, input, call);
  }
}
