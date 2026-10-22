import { PROTOCOL_LIMITS } from '@shinsa/core';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const L = PROTOCOL_LIMITS;

function limitedText(description: string, maxLength: number) {
  return { type: 'string', description: `${description} At most ${maxLength} characters.`, maxLength };
}

function textList(description: string, maxItems: number, maxLength: number) {
  return { type: 'array', description, maxItems, items: { type: 'string', maxLength } };
}

const LINE = { type: 'integer', minimum: 1 };

const SPOT = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'Path relative to the repository root.' },
    start: { ...LINE, description: 'First line, numbered as in the new file.' },
    end: { ...LINE, description: 'Last line, numbered as in the new file.' },
    attention: {
      type: 'string',
      enum: ['critical', 'high', 'normal'],
      description:
        'critical: could break something or encodes a judgement call. high: worth a careful read. normal: context.',
    },
    why: limitedText(
      'Why the human should read these lines: the risk or the decision, not what the code says.',
      L.why
    ),
  },
  required: ['file', 'start', 'end', 'attention', 'why'],
};

export const TOOL_SPECS = {
  propose_plan: {
    name: 'propose_plan',
    description:
      'Hand the plan over, then end your turn. Each phase is then built by its own agent. Every field has a hard limit; a plan that breaks one is rejected with the reasons.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: limitedText('The outcome in one or two sentences.', L.goal),
        plan: {
          type: 'array',
          description:
            'The work as 2 to 8 phases in the order they will be done. Each is one visible step of progress.',
          minItems: 2,
          maxItems: L.planSteps,
          items: {
            type: 'object',
            properties: {
              title: limitedText('The phase in a few words, e.g. "Wire the MCP session".', L.planTitle),
              detail: limitedText('What happens in it, one sentence.', L.planDetail),
            },
            required: ['title', 'detail'],
          },
        },
        behaviour: textList(
          'How it behaves after the change, one observable behaviour per item.',
          L.behaviour,
          L.behaviourItem
        ),
        approach: limitedText('How it will be built, and the decisions you made on the way.', L.approach),
        files: {
          type: 'array',
          maxItems: L.files,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              change: limitedText('What changes in it.', L.fileChange),
            },
            required: ['path', 'change'],
          },
        },
        out_of_scope: textList('What this deliberately does not do.', L.listItems, L.listItem),
        verification: textList('How it will be proven to work.', L.listItems, L.listItem),
        questions: {
          type: 'array',
          description: 'Decisions only the human can make. Empty when there are none.',
          maxItems: L.questions,
          items: {
            type: 'object',
            properties: {
              question: limitedText('One question.', L.question),
              options: textList('2 to 4 concrete options.', L.options, L.option),
              recommendation: limitedText(
                'The option you recommend, worded exactly as in options.',
                L.option
              ),
            },
            required: ['question', 'options'],
          },
        },
      },
      required: [
        'goal',
        'plan',
        'behaviour',
        'approach',
        'files',
        'out_of_scope',
        'verification',
        'questions',
      ],
    },
  },
  complete_phase: {
    name: 'complete_phase',
    description:
      'Hand your finished phase over, then end your turn. Shinsa commits the changes and starts the next phase, or runs the checks after the last one. The summary and spots are what the human reads at review; a hand-over that breaks a limit is rejected with the reasons.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'What this phase changed, one or two sentences. Wrap identifiers in backticks.',
          L.phaseSummary
        ),
        spots: {
          type: 'array',
          description:
            'The line ranges the human must read. Empty only when the phase changed nothing worth reading.',
          maxItems: L.spots,
          items: SPOT,
        },
        decisions: {
          type: 'array',
          description: 'Judgement calls the human might disagree with. Empty when there are none.',
          maxItems: L.decisions,
          items: {
            type: 'object',
            properties: {
              decision: limitedText('What you decided.', L.decision),
              reason: limitedText('Why, and the alternative.', L.reason),
              file: { type: 'string' },
              line: LINE,
            },
            required: ['decision', 'reason'],
          },
        },
      },
      required: ['summary', 'spots', 'decisions'],
    },
  },
  complete_fix: {
    name: 'complete_fix',
    description:
      'Hand your fix over, then end your turn. Shinsa commits it and runs the checks and the agent review again, or pushes it to the pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'What you changed and, for anything you chose not to change, why.',
          L.phaseSummary
        ),
      },
      required: ['summary'],
    },
  },
  report_review: {
    name: 'report_review',
    description:
      'Report your review findings, then end your turn. An empty list means you found nothing wrong. Each finding is anchored to the lines it is about.',
    inputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          maxItems: L.findings,
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['blocking', 'suggestion'] },
              file: { type: 'string' },
              line: { ...LINE, description: 'First line, numbered as in the new file.' },
              end: { ...LINE, description: 'Last line.' },
              message: limitedText('What is wrong and what to do about it.', L.finding),
            },
            required: ['severity', 'message'],
          },
        },
      },
      required: ['findings'],
    },
  },
  ask: {
    name: 'ask',
    description:
      'Ask the human one question when you are blocked on a decision only they can make. Waits for the answer and returns it. Do not ask for anything you can find out yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'One clear question.' },
        context: {
          type: 'string',
          description: 'What they need to know to answer, and the options you see.',
        },
      },
      required: ['question'],
    },
  },
  attach_evidence: {
    name: 'attach_evidence',
    description:
      'Attach proof that the work does what was asked: a screenshot or recording file, a test run, or a preview URL. The human sees it before the diff.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['screenshot', 'recording', 'test', 'check', 'note', 'preview'] },
        title: { type: 'string', description: 'What it shows, in a few words.' },
        path: {
          type: 'string',
          description: 'A file (image, video, log), absolute or relative to the worktree.',
        },
        url: { type: 'string', description: 'A URL, for previews.' },
        text: { type: 'string', description: 'Text evidence, for test output or notes.' },
      },
      required: ['kind', 'title'],
    },
  },
  find_tasks: {
    name: 'find_tasks',
    description:
      'Find tasks Shinsa tracks, to link them for the human. Returns each task as a ready shinsa:// markdown link with its status, repository, branch and pull request. Use those links verbatim; never guess an id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Words from a title, request, branch or repository, or a pull request number like #4531. Empty lists the most recent tasks.',
        },
      },
    },
  },
  note: {
    name: 'note',
    description:
      'Leave a short note on the task for later: a decision you made, a follow-up worth doing. It shows on the task page.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
} satisfies Record<string, ToolSpec>;

export type ShinsaToolName = keyof typeof TOOL_SPECS;
