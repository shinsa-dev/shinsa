import {
  type ChangeProposalInput,
  COMPOSABLE_STEPS,
  type DeliveringStep,
  PROTOCOL_LIMITS,
  SCHEDULE_LIMITS,
  SHAPE_LIMITS,
  type ShinsaEvent,
  STEP_SCHEMA,
  validateDelivery,
  validateIntakeReport,
  validateReshape,
  validateWatchReport,
} from '@shinsa/core';
import { assertProtocol, HANDED_OVER } from '../handover.ts';
import type { ProcessToolCall } from './process.ts';
import { limitedText, type ToolSpec } from './schema.ts';

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
        propose_change: PROPOSE_CHANGE_SPEC,
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
        propose_change: PROPOSE_CHANGE_SPEC,
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
        propose_change: PROPOSE_CHANGE_SPEC,
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
      },
      required: ['outcome'],
    },
  },
  report_watch: {
    name: 'report_watch',
    description:
      'Report a watchdog check, then stop without restating it: what you looked at and whether the shipped change is healthy. An issue becomes a new task forked from this one, so its agent starts from this conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        live: {
          type: 'boolean',
          description:
            'Only for a watchdog waiting for production: true once the change is live there (then also check it), false while it is not.',
        },
        healthy: {
          type: 'boolean',
          description:
            'True when nothing is wrong with what the watchdog watches. Not needed while live is false.',
        },
        summary: limitedText(
          'What you looked at and what you saw, with the numbers.',
          PROTOCOL_LIMITS.watchSummary
        ),
        issue: {
          type: 'object',
          description: 'Only when healthy is false: the issue the change caused.',
          properties: {
            title: limitedText('The issue in a few words.', PROTOCOL_LIMITS.watchIssueTitle),
            request: limitedText(
              'The fix as the human would ask for it, with the evidence: what broke, where and since when.',
              PROTOCOL_LIMITS.watchIssueRequest
            ),
          },
          required: ['title', 'request'],
        },
      },
      required: ['summary'],
    },
  },
  report_intake: {
    name: 'report_intake',
    description:
      'Report a read of an automation’s data source, then stop without restating it: what you read, the tasks you filed with `file_report` and what you skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'What you read, what you filed and what you skipped, with the counts.',
          SCHEDULE_LIMITS.intakeSummary
        ),
        reached: {
          type: 'boolean',
          description: `False when the source still failed after ${SCHEDULE_LIMITS.readAttempts} tries, so the next read covers this one's time again. True when left out.`,
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

const DELIVERING_TOOLS = new Map<string, DeliveringStep>([
  ['answer', 'answer'],
  ['report_diagnosis', 'investigate'],
  ['submit_report', 'research'],
  ['report_outcome', 'operate'],
]);

const UNCHANGED = 'Those are the steps this task already has. Plan it with `propose_plan`.';

function hasReshaped(events: ShinsaEvent[]) {
  return events.some((event) => event.type === 'task.reshaped');
}

function withProposal(proposal: ChangeProposalInput | null) {
  return proposal ? { proposal } : {};
}

export async function handleShapeTool(name: string, input: Record<string, unknown>, call: ProcessToolCall) {
  const { runId, attemptId } = call;
  const step = DELIVERING_TOOLS.get(name);
  if (step) {
    const { body, proposal } = assertProtocol(validateDelivery(step, input));
    await call.dispatch({ type: 'agent.deliver', runId, attemptId, step, body, ...withProposal(proposal) });
    return HANDED_OVER;
  }
  if (name === 'report_watch') {
    const watch = assertProtocol(validateWatchReport(input));
    await call.dispatch({ type: 'agent.report_watch', runId, attemptId, ...watch });
    return HANDED_OVER;
  }
  if (name === 'report_intake') {
    const intake = assertProtocol(validateIntakeReport(input));
    await call.dispatch({ type: 'agent.report_intake', runId, attemptId, ...intake });
    return HANDED_OVER;
  }
  if (name === 'reshape_task') {
    const reshape = assertProtocol(validateReshape(input));
    const events = await call.dispatch({ type: 'agent.reshape', runId, attemptId, ...reshape });
    return hasReshaped(events) ? HANDED_OVER : UNCHANGED;
  }
  return null;
}
