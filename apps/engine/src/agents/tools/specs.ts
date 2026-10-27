import {
  ATTACHED_EVIDENCE_KINDS,
  ATTENTION_LEVELS,
  EVIDENCE_STAGES,
  EVIDENCE_THEMES,
  FINDING_SEVERITIES,
  MANUAL_TEST_TARGETS,
  MERGE_STEP_KINDS,
  MERGE_STEP_TIMINGS,
  PLAN_EVIDENCE_KINDS,
  PROTOCOL_LIMITS,
  type ShinsaToolName,
  VERIFICATION_RULES,
} from '@shinsa/core';
import { ORCHESTRATION_TOOL_SPECS } from './orchestration.ts';
import { CHANGE_SUMMARY_SPEC, CHOICES_SPEC, PROCESS_TOOL_SPECS } from './process.ts';
import { SCHEDULE_TOOL_SPECS } from './schedules.ts';
import { limitedPath, limitedText, type ToolSpec, textList } from './schema.ts';
import { SHAPE_TOOL_SPECS } from './shapes.ts';

const L = PROTOCOL_LIMITS;

function resolveRequirement(id: string) {
  return VERIFICATION_RULES.find((rule) => rule.id === id)?.requirement ?? '';
}

const CODE_ONLY = 'Only for a task that changes code; a plan for any other task that sets it is refused.';

const LINE = { type: 'integer', minimum: 1 };

const SPOT = {
  type: 'object',
  properties: {
    file: limitedPath('Path relative to the repository root.'),
    start: { ...LINE, description: 'First line, numbered as in the new file.' },
    end: { ...LINE, description: 'Last line, numbered as in the new file.' },
    attention: {
      type: 'string',
      enum: [...ATTENTION_LEVELS],
      description:
        'critical: could break something or encodes a judgement call. high: worth a careful read. normal: context.',
    },
    why: limitedText(
      'Why the human should read these lines: the risk or the judgement call, not what the code says.',
      L.why
    ),
    title: limitedText('For a key piece of code: what it is, in a few words.', L.spotTitle),
    explain: limitedText(
      'For a key piece of code: how it works, in plain words a reader new to the code follows.',
      L.explain
    ),
  },
  required: ['file', 'start', 'end', 'attention', 'why'],
};

const PLACE = {
  file: limitedPath('Path relative to the repository root.'),
  line: { ...LINE, description: 'First line, numbered as in the new file.' },
  end: { ...LINE, description: 'Last line.' },
};

const WALKTHROUGH_PARTS = {
  approach: limitedText(
    'How the task was achieved: the idea of the change and its structure, in a few short paragraphs.',
    L.walkthroughApproach
  ),
  flow: limitedText(
    'How it works behind the scenes: the flow of data and control through the new code, step by step. A small text diagram in a code fence helps.',
    L.flow
  ),
  risks: {
    type: 'array',
    description: 'Risks and edge cases the reader should know, each with its lines when it has them.',
    maxItems: L.risks,
    items: {
      type: 'object',
      properties: {
        title: limitedText('A few words naming the risk.', L.riskTitle),
        risk: limitedText('The risk or edge case and what happens.', L.risk),
        ...PLACE,
      },
      required: ['title', 'risk'],
    },
  },
  testing: {
    type: 'object',
    description:
      'How to test it, in two parts: what the automated tests cover, and a guide the human follows by hand.',
    properties: {
      automated: textList(
        'One or two lines on what the tests cover: which test files, and what they prove.',
        L.testingAutomated,
        L.testingAutomatedItem
      ),
      manual: {
        type: 'array',
        description:
          'A guided walkthrough the human follows, in order. Start from where to go: the preview deployment URL, or the command that starts the app and its local URL. Then one concrete step each: what to open, click or type, and what they should see. Add the edge cases worth trying. Link a file in an action as [label](shinsa://file/path#L12-L20). Empty when there is nothing to try by hand.',
        maxItems: L.testingSteps,
        items: {
          type: 'object',
          properties: {
            action: limitedText(
              'What to do, as an instruction: "Open the paywall list", "Click Duplicate on a code paywall".',
              L.testingAction
            ),
            target: {
              type: 'object',
              description:
                'Where the step happens, when it has one place. url: an http or https address (a preview deployment or a local URL). file: a path relative to the repository root, with :line or :start-end for lines. command: the exact shell command. screen: the name of a screen in the app.',
              properties: {
                kind: {
                  type: 'string',
                  enum: [...MANUAL_TEST_TARGETS],
                  description: 'What kind of place it is.',
                },
                value: limitedText('The URL, path, command or screen name.', L.testingTarget),
              },
              required: ['kind', 'value'],
            },
            expect: limitedText(
              'What the human should see when it works, concrete enough to tell pass from fail.',
              L.testingExpect
            ),
          },
          required: ['action', 'expect'],
        },
      },
    },
  },
  steps: {
    type: 'array',
    description:
      'What the human must do around the merge that needs a person or production access, which no agent can do from the worktree: an environment variable or secret to set, a migration or deploy to run, a config or feature flag to change, a service to restart, a backfill, a third-party setting. Do everything you can in the repository yourself (code, tests, docs, `.env.example`, migration files) and list only the rest. The merge waits until the human ticks every pre-merge step; a post-merge step opens only once the pull request merged. Leave it out when there is nothing.',
    maxItems: L.mergeSteps,
    items: {
      type: 'object',
      properties: {
        when: {
          type: 'string',
          enum: [...MERGE_STEP_TIMINGS],
          description:
            'pre_merge: done before the merge, because the merged code needs it in place. post_merge: done only once the pull request merged, because it needs the merged code.',
        },
        kind: { type: 'string', enum: [...MERGE_STEP_KINDS], description: 'What kind of step it is.' },
        title: limitedText(
          'The step as an instruction, naming the thing: "Set STRIPE_WEBHOOK_SECRET in production". Unique in the list.',
          L.mergeStepTitle
        ),
        detail: limitedText(
          'Where and how: the service or dashboard, the environment, where the value comes from. Never a secret’s value.',
          L.mergeStepDetail
        ),
        command: limitedText(
          'The exact shell command, when the step is one. The human can run it in a terminal from the task.',
          L.mergeStepCommand
        ),
      },
      required: ['when', 'kind', 'title', 'detail'],
    },
  },
};

const WALKTHROUGH = {
  type: 'object',
  description:
    'The technical walkthrough of the whole change, the document the human reads at review. Required on the last phase; leave it out before.',
  properties: WALKTHROUGH_PARTS,
  required: ['approach', 'flow'],
};

const WALKTHROUGH_REVISION = {
  type: 'object',
  description:
    'Send only when the fix changes how the change works: the approach, the flow, a risk, how to test it or the steps around the merge. Give only the parts that changed; each replaces that part of the walkthrough whole. Leave it out otherwise.',
  properties: WALKTHROUGH_PARTS,
};

export const TOOL_SPECS = {
  propose_plan: {
    name: 'propose_plan',
    description:
      'Hand the plan over, then stop without restating it. You then build each phase yourself, in this same conversation. Every field has a hard limit; a plan that breaks one is rejected with the reasons.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: limitedText('The outcome in one or two sentences.', L.goal),
        phases: {
          type: 'array',
          description: `The work as ${L.minPlanPhases} to ${L.planPhases} phases in the order they will be done. Each is one visible step of progress.`,
          minItems: L.minPlanPhases,
          maxItems: L.planPhases,
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
        approach: limitedText('How it will be built, and the choices you made on the way.', L.approach),
        files: {
          type: 'array',
          maxItems: L.files,
          items: {
            type: 'object',
            properties: {
              path: limitedPath('Path relative to the repository root.'),
              change: limitedText('What changes in it.', L.fileChange),
            },
            required: ['path', 'change'],
          },
        },
        out_of_scope: textList('What this deliberately does not do.', L.listItems, L.listItem),
        verification: textList(
          `The verification plan, required for any task that changes code: ${resolveRequirement('code.verification_plan')} One item per proof: the tests, checks, runs or screenshots that show it works.`,
          L.listItems,
          L.listItem
        ),
        impact: limitedText(
          `Required for any task that runs an operation: ${resolveRequirement('operation.impact')} Leave it out otherwise.`,
          L.impact
        ),
        evidence: {
          type: 'array',
          description: `The kinds of evidence you attach with \`attach_evidence\` before the human reviews, each named once. Shinsa refuses the last phase until each kind is attached. ${CODE_ONLY}`,
          maxItems: PLAN_EVIDENCE_KINDS.length,
          uniqueItems: true,
          items: { type: 'string', enum: [...PLAN_EVIDENCE_KINDS] },
        },
        checks: textList(
          `Commands Shinsa runs in the worktree after the repository's own checks. ${resolveRequirement('code.checks')} Leave it out when the repository's checks prove the change. At most ${L.planChecks} commands of ${L.checkCommand} characters each. ${CODE_ONLY}`,
          L.planChecks,
          L.checkCommand
        ),
        approval: {
          type: 'boolean',
          description:
            'True asks the human to approve the plan before anything is built or run, even when Approve plans is off. Set it when the change is risky.',
        },
        operation: textList(
          'Only for a task that both changes code and runs an operation: the operation’s steps in order, each with how to check it worked. Leave it out otherwise.',
          L.planPhases,
          L.listItem
        ),
        questions: {
          type: 'array',
          description: 'Decisions only the human can make. Empty when there are none.',
          maxItems: L.questions,
          items: {
            type: 'object',
            properties: {
              question: limitedText('One question.', L.question),
              options: textList(`2 to ${L.options} concrete options.`, L.options, L.option),
              recommendation: limitedText(
                'The option you recommend, worded exactly as in options.',
                L.option
              ),
            },
            required: ['question', 'options'],
          },
        },
        change_summary: CHANGE_SUMMARY_SPEC,
      },
      required: [
        'goal',
        'phases',
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
      'Hand your finished phase over, then stop without restating it. Shinsa commits the changes and starts the next phase, or runs the checks after the last one. The summary and spots are what the human reads at review; a hand-over that breaks a limit is rejected with the reasons.',
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
            'Every line range the human must read, the key pieces of code explained. Empty only when the phase changed nothing worth reading.',
          maxItems: L.spots,
          items: SPOT,
        },
        judgement_calls: {
          type: 'array',
          description:
            'Every judgement call the human might make differently, with the alternatives. Empty when there are none.',
          maxItems: L.judgementCalls,
          items: {
            type: 'object',
            properties: {
              title: limitedText('A few words naming the decision.', L.callTitle),
              call: limitedText('What you decided.', L.call),
              reason: limitedText('Why.', L.reason),
              ...PLACE,
              alternatives: {
                type: 'array',
                description: 'The options you rejected.',
                maxItems: L.alternatives,
                items: {
                  type: 'object',
                  properties: {
                    option: limitedText('The other option.', L.alternativeOption),
                    rejected: limitedText('Why you did not take it.', L.alternativeRejected),
                  },
                  required: ['option', 'rejected'],
                },
              },
            },
            required: ['title', 'call', 'reason'],
          },
        },
        walkthrough: WALKTHROUGH,
      },
      required: ['summary', 'spots', 'judgement_calls'],
    },
  },
  complete_fix: {
    name: 'complete_fix',
    description:
      'Hand your fix over, then stop without restating it. Shinsa commits it and runs the checks and the agent review again, or pushes it to the pull request.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'What you changed and, for anything you chose not to change, why.',
          L.phaseSummary
        ),
        walkthrough: WALKTHROUGH_REVISION,
      },
      required: ['summary'],
    },
  },
  report_review: {
    name: 'report_review',
    description:
      'Report your review findings, then stop without restating them. An empty list means you found nothing wrong. Each finding is anchored to the lines it is about.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: limitedText(
          'One or two sentences: what you checked and your overall view of the change.',
          L.reviewSummary
        ),
        findings: {
          type: 'array',
          maxItems: L.findingCount,
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: [...FINDING_SEVERITIES] },
              file: limitedPath('Path relative to the repository root.'),
              line: { ...LINE, description: 'First line, numbered as in the new file.' },
              end: { ...LINE, description: 'Last line.' },
              title: limitedText('What is wrong, in a few words.', L.findingTitle),
              message: limitedText('What is wrong and why it matters.', L.finding),
              fix: limitedText('What to change: a sentence, or a short code block.', L.findingFix),
            },
            required: ['severity', 'message'],
          },
        },
        disagreements: {
          type: 'array',
          description:
            'The agent’s judgement calls you would have made differently, by their number in your brief. Leave out the ones you agree with.',
          maxItems: L.disagreements,
          items: {
            type: 'object',
            properties: {
              call: { ...LINE, description: 'The judgement call’s number in your brief.' },
              reason: limitedText('Why you disagree, and what you would do instead.', L.disagreement),
            },
            required: ['title', 'call', 'reason'],
          },
        },
      },
      required: ['findings'],
    },
  },
  ask: {
    name: 'ask',
    description:
      'Ask the human one question when you are blocked on a decision only they can make. Waits for the answer and returns it. Do not ask for anything you can find out yourself. When the human has to run a command themselves (an interactive sign-in, a server they run), put the exact command in a ```bash run block in `context`: they can run it in a terminal with one press. A plain ```bash block is only for an example.',
    inputSchema: {
      type: 'object',
      properties: {
        question: limitedText('One clear question.', L.question),
        context: limitedText('What they need to know to answer, and the options you see.', L.questionContext),
        ...CHOICES_SPEC,
      },
      required: ['question'],
    },
  },
  attach_evidence: {
    name: 'attach_evidence',
    description:
      'Attach proof that the work does what was asked: a comparison of one view before and after, a screenshot or recording file, a test or check run, a note, or a preview URL. The human sees it in the review before the diff, each call as one item. Give exactly one of path, url or text, or for a comparison its parts. For screenshots set width, theme and stage; a before shot and an after shot with the same title, width and theme show as one comparison, so a before taken early and its after taken later still pair.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [...ATTACHED_EVIDENCE_KINDS],
          description:
            'comparison: one view in two or more states (before and after) as one item, with parts; screenshot: one image; recording: a short video of an interaction; test or check: run output; note: markdown, a table for measurements; preview: a URL.',
        },
        title: limitedText(
          'What it shows, in a few words: the screen or flow, never the file name.',
          L.evidenceTitle
        ),
        detail: limitedText('What to look at in it, in one sentence.', L.evidenceDetail),
        width: {
          type: 'integer',
          description: 'The viewport width in CSS pixels, for a screenshot or recording.',
          minimum: 1,
          maximum: L.evidenceWidth,
        },
        theme: {
          type: 'string',
          enum: [...EVIDENCE_THEMES],
          description: 'The colour theme it was captured in.',
        },
        stage: {
          type: 'string',
          enum: [...EVIDENCE_STAGES],
          description: 'before: the app as it was, captured before your change; after: with your change.',
        },
        path: limitedPath('A file (image, video, log), absolute or relative to the worktree.'),
        url: limitedText('A URL, for previews.', L.evidenceUrl),
        text: limitedText('Text evidence: test or check output, or a note in markdown.', L.evidenceText),
        parts: {
          type: 'array',
          description:
            'For a comparison only: each state of the view as an image or video file, in order, named by its stage (before, after) or a short label (Empty, Loading, Light, Dark).',
          minItems: 2,
          maxItems: L.evidenceParts,
          items: {
            type: 'object',
            properties: {
              path: limitedPath('The file, absolute or relative to the worktree.'),
              stage: { type: 'string', enum: [...EVIDENCE_STAGES] },
              label: limitedText(
                'The state it shows, when it is not simply before or after.',
                L.evidenceLabel
              ),
            },
            required: ['path'],
          },
        },
      },
      required: ['kind', 'title'],
    },
  },
  find_tasks: {
    name: 'find_tasks',
    description:
      'Find tasks in any project, to link them for the human. Returns each task as a ready shinsa:// markdown link with its status, repository, branch and pull request. Use those links verbatim; never guess an id.',
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
  read_task: {
    name: 'read_task',
    description:
      "Read another task: its status, request, plan, open decisions, recent activity and its agents' latest replies. It only reads; it never changes the task.",
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task id, from find_tasks or a shinsa://task/<id> link.',
        },
      },
      required: ['task_id'],
    },
  },
  list_repository_work: {
    name: 'list_repository_work',
    description:
      'List the other open tasks in the repository this task works in, as ready shinsa:// markdown links: each with its stage, its branch, what that branch is stacked on, the files it changed (committed or not) and whether an agent works on it now. Use it before you change files another task may be changing. It only reads.',
    inputSchema: { type: 'object', properties: {} },
  },
  list_services: {
    name: 'list_services',
    description:
      'List the project’s services this task can run (its dev servers and the like), each with its command, the folder in this task’s worktree and whether it runs for this task. Name one in `service` to read the last lines of its output. It only reads.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'A service’s name, to read its output.' },
      },
    },
  },
  run_service: {
    name: 'run_service',
    description:
      'Start, stop or restart one of the project’s services for this task only, in its own terminal in this task’s worktree; never the human’s own run or another task’s. Two runs of one service may want the same port: when it fails, read its output with `list_services`.',
    inputSchema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'The service’s name, from list_services.' },
        action: { type: 'string', enum: ['start', 'stop', 'restart'] },
      },
      required: ['service', 'action'],
    },
  },
  note: {
    name: 'note',
    description:
      'Leave a short note on the task for later: a choice you made, or something worth doing next. It shows on the task page.',
    inputSchema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
  ...PROCESS_TOOL_SPECS,
  ...SHAPE_TOOL_SPECS,
  ...ORCHESTRATION_TOOL_SPECS,
  ...SCHEDULE_TOOL_SPECS,
} satisfies Record<ShinsaToolName, ToolSpec>;
