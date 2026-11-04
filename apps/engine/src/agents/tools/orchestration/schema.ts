import {
  DELEGATE_ROLES,
  DELEGATION_ISOLATIONS,
  DELEGATION_LIMITS,
  DELEGATION_MODES,
  type DelegateRole,
  type DomainError,
  PROTOCOL_LIMITS,
  type Repo,
  type RunRole,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import type { Duration, Effect } from 'effect';
import type { ToolCallFailed, ToolSpec } from '../schema.ts';

const L = DELEGATION_LIMITS;

export const DEFAULT_ROLE: Record<RunRole, DelegateRole> = {
  agent: 'builder',
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  answerer: 'planner',
  investigator: 'builder',
  researcher: 'planner',
};

const DELEGATION_ID = {
  type: 'string',
  maxLength: DELEGATION_LIMITS.name,
  description: 'The delegation_id that `delegate_task` returned.',
};

const CLIENT_REQUEST_ID = {
  type: 'string',
  maxLength: L.requestKey,
  description:
    'A key of your own that identifies this call. Retrying with the same key returns the same work instead of starting it twice.',
};

export const ORCHESTRATION_TOOL_SPECS = {
  delegate_task: {
    name: 'delegate_task',
    description: [
      'Hand one self-contained piece of work to another agent and get its result back. It starts from the `brief` you give it alone, without this conversation, so put everything it needs in it.',
      'Delegate only work whose context should stay apart from yours: a review or a test your own reasoning would bias, or work that is truly independent of yours and can run in parallel. Everything else you do yourself, in this conversation: never one agent per phase or per kind of problem.',
      `mode "async" (the default) returns at once; the result arrives in this conversation when the agent finishes, steered into your turn or waking you after it ends, so carry on or stop instead of polling. mode "wait" blocks until the result, a question from the agent, or timeout_minutes (${L.waitMinutes} by default); a wait that times out does not stop the agent, and its result still arrives here.`,
      'For every review round, call delegate_task again with the original brief, the earlier findings, your responses and the open objections, under a new client_request_id.',
      'An agent that cannot change files, including one that is planning, can only delegate to the planner and reviewer roles. isolation "worktree" gives the agent its own checkout of your last commit; your uncommitted edits are not in it.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          maxLength: L.brief,
          description:
            'The complete instruction: what to do, where, what you already know, and what to report back.',
        },
        title: {
          type: 'string',
          maxLength: L.title,
          description: 'The work in a few words, shown to the human.',
        },
        role: {
          type: 'string',
          enum: DELEGATE_ROLES,
          description:
            'planner investigates without changing files, reviewer reviews or tests without changing files, builder changes files. Defaults to builder while you can change files, otherwise to planner (reviewer for a reviewer).',
        },
        mode: { type: 'string', enum: [...DELEGATION_MODES] },
        timeout_minutes: {
          type: 'integer',
          minimum: 1,
          maximum: L.maxWaitMinutes,
          description: 'With mode "wait", how long to wait for the result. The agent keeps working after it.',
        },
        isolation: { type: 'string', enum: [...DELEGATION_ISOLATIONS] },
        client_request_id: CLIENT_REQUEST_ID,
        provider: {
          type: 'string',
          maxLength: DELEGATION_LIMITS.name,
          description: 'The agent provider to run it on. Defaults to the one Shinsa uses.',
        },
        model: {
          type: 'string',
          maxLength: DELEGATION_LIMITS.name,
          description: 'The model to run it on. Defaults to the model set for its role.',
        },
      },
      required: ['brief'],
    },
  },
  delegation_status: {
    name: 'delegation_status',
    description:
      'Read a delegation: its status, its open question, and its result once it has one. Reading a finished result counts as receiving it, so it is not delivered to you again. Do not poll: results arrive by themselves.',
    inputSchema: {
      type: 'object',
      properties: { delegation_id: DELEGATION_ID },
      required: ['delegation_id'],
    },
  },
  delegation_cancel: {
    name: 'delegation_cancel',
    description:
      'Stop a delegation, and every delegation it started in turn. You get no report for it. A finished delegation stays as it is.',
    inputSchema: {
      type: 'object',
      properties: { delegation_id: DELEGATION_ID },
      required: ['delegation_id'],
    },
  },
  delegation_answer: {
    name: 'delegation_answer',
    description:
      'Answer the question a delegation is waiting on. When only the human can decide, ask them with `ask` first, then answer here.',
    inputSchema: {
      type: 'object',
      properties: { delegation_id: DELEGATION_ID, answer: { type: 'string', maxLength: L.answer } },
      required: ['delegation_id', 'answer'],
    },
  },
  create_task: {
    name: 'create_task',
    description:
      'Create a new task for work outside this one, such as the part of this change that belongs in another repository: each task works in one repository and ships one pull request. It starts at once, or with after_this once this task is finished (merged, or done when it ships no pull request), and ends at the human’s review like any task. Whoever picks it up sees nothing of this task unless it is forked, so the request must stand on its own. Set fork_from to this task for the other part of this change, or to a task that shipped a feature for follow-up work on it: the new task’s agent starts from a copy of that task’s conversation. Set this_task_waits when this task cannot be merged before the new one, and after_this when the new one cannot be merged before this task; never both. Set stack_on_this instead for the next piece of a bundle in this repository: the new task starts once this one is ready to merge, branches off this task’s branch, and the two merge together. Add stack_on to stack it on other tasks of the bundle as well, such as one that joins several parallel pieces. Stack when the new task builds directly on this task’s code and ships with it, so a flaw it finds here is fixed in this pull request before anything merges. Use after_this when this task should ship on its own first: it is worth merging even if the follow-up stalls, the follow-up needs this change live on the default branch, or it works in another repository.',
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          maxLength: PROTOCOL_LIMITS.suggestionRequest,
          description: 'The request as the human would write it: what to change, where, and why.',
        },
        repository: {
          type: 'string',
          maxLength: DELEGATION_LIMITS.name,
          description: 'The repository it belongs in, by name. Defaults to this one.',
        },
        new_repository: {
          type: 'boolean',
          description:
            'With repository: when no repository by that name exists yet, create it as a new folder in the project’s folder, start it with an empty first commit and register it. An existing one is used as it is.',
        },
        project: {
          type: 'string',
          maxLength: DELEGATION_LIMITS.name,
          description:
            'The project it belongs in, by key, name or id, when not this task’s. Without repository, triage picks a repository in that project.',
        },
        fork_from: {
          type: 'string',
          maxLength: DELEGATION_LIMITS.name,
          description:
            'A task to fork, by id or handle (this one included): the new task starts from its conversation.',
        },
        this_task_waits: { type: 'boolean' },
        after_this: {
          type: 'boolean',
          description:
            'The new task waits until this one is finished (merged, or done when it ships no pull request), then starts.',
        },
        stack_on_this: {
          type: 'boolean',
          description:
            'The new task stacks on this one as a bundle: it starts once this task is ready to merge, its pull request is based on this task’s branch, and the bundle merges as one. Alone, never with after_this or this_task_waits.',
        },
        stack_on: {
          type: 'array',
          maxItems: DELEGATION_LIMITS.stackOn,
          items: { type: 'string', maxLength: DELEGATION_LIMITS.name },
          description:
            'Other tasks in this repository the new task stacks on too, by id or handle. It starts once every task it stacks on is ready to merge, its pull request is based on the first one (this task first with stack_on_this), and the others are merged into its branch.',
        },
        backlog: {
          type: 'boolean',
          description:
            'The new task triages and plans, then waits in the human’s backlog until they start building it. Only when the human asked to keep it for later.',
        },
        client_request_id: CLIENT_REQUEST_ID,
      },
      required: ['request'],
    },
  },
  split_task: {
    name: 'split_task',
    description: `Split the rest of the accepted plan into separate tasks when it has parts that belong apart: different owners, parallel work, or separate reviews. Each becomes a task under this one that ends at its own review. A plan is split once: calling it again for the same plan returns the tasks it already made. Keep the work here when it is small and cohesive. At most ${L.splitTasks} tasks.`,
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: L.splitTasks,
          items: {
            type: 'object',
            properties: {
              request: {
                type: 'string',
                maxLength: PROTOCOL_LIMITS.suggestionRequest,
                description: 'The part as a request that stands on its own.',
              },
            },
            required: ['request'],
          },
        },
        this_task_waits: { type: 'boolean', description: 'True when this task merges after them.' },
      },
      required: ['tasks'],
    },
  },
} satisfies Record<string, ToolSpec>;

export type DelegationOutcome = 'settled' | 'question' | 'timeout';

export interface OrchestrationCall {
  readonly runId: string;
  readonly attemptId: string;
  readonly requestKey: string;
  readonly signal: AbortSignal;
  readonly minute: Duration.Duration;
  readonly state: Effect.Effect<ShinsaState>;
  readonly dispatch: (
    command: ShinsaCommand,
    id?: string
  ) => Effect.Effect<ShinsaEvent[], ToolCallFailed | DomainError>;
  readonly resolveBaseCommit: Effect.Effect<string, ToolCallFailed | DomainError>;
  readonly registerRepo: (
    projectId: string | null,
    name: string
  ) => Effect.Effect<Repo | null, ToolCallFailed | DomainError>;
  readonly createRepo: (projectId: string, name: string) => Effect.Effect<Repo, ToolCallFailed | DomainError>;
  readonly hasProvider: (id: string) => boolean;
  readonly awaitDelegation: (
    childRunId: string,
    timeout: Duration.Duration,
    signal: AbortSignal
  ) => Effect.Effect<DelegationOutcome>;
  readonly recordStarted: (childRunId: string) => Effect.Effect<void>;
}
