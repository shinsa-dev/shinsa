import {
  DELEGATE_ROLES,
  DELEGATION_ISOLATIONS,
  DELEGATION_LIMITS,
  DELEGATION_MODES,
  type DelegatedRun,
  type DelegateRole,
  isDelegatedRun,
  listChildRuns,
  listLiveChildRuns,
  PROTOCOL_LIMITS,
  type Repo,
  type Run,
  type RunRole,
  resolveDelegationStatus,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
  serializeReference,
  type Task,
  validateCourierTask,
  validateDelegationAnswer,
  validateDelegationReference,
  validateDelegationRequest,
  validateSplit,
} from '@shinsa/core';
import { assertProtocol } from '../handover.ts';
import { findForkSource } from './forks.ts';
import type { ToolSpec } from './schema.ts';

const L = DELEGATION_LIMITS;

const DEFAULT_ROLE: Record<RunRole, DelegateRole> = {
  agent: 'builder',
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  answerer: 'planner',
  investigator: 'builder',
  researcher: 'planner',
};

function resolveDefaultRole(parent: Run): DelegateRole {
  return parent.purpose === 'plan' ? 'planner' : DEFAULT_ROLE[parent.role];
}

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
      'Create a new task for work outside this one, such as the part of this change that belongs in another repository: each task works in one repository and ships one pull request. It starts at once, or with after_this once this task is finished (merged, or done when it ships no pull request), and ends at the human’s review like any task. Whoever picks it up sees nothing of this task unless it is forked, so the request must stand on its own. Set fork_from to this task for the other part of this change, or to a task that shipped a feature for follow-up work on it: the new task’s agent starts from a copy of that task’s conversation. Set this_task_waits when this task cannot be merged before the new one, and after_this when the new one cannot be merged before this task; never both.',
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
  runId: string;
  attemptId: string;
  requestKey: string;
  signal: AbortSignal;
  minuteMs: number;
  state: () => ShinsaState;
  dispatch: (command: ShinsaCommand, id?: string) => Promise<ShinsaEvent[]>;
  resolveBaseCommit: () => Promise<string>;
  registerRepo: (task: Task, name: string) => Promise<Repo | null>;
  hasProvider: (id: string) => boolean;
  awaitDelegation: (childRunId: string, timeoutMs: number, signal: AbortSignal) => Promise<DelegationOutcome>;
  recordStarted: (childRunId: string) => void;
}

function resolveCommandId(call: OrchestrationCall, tool: string, requestKey: string | null) {
  return requestKey === null ? undefined : `agent:${call.runId}:${call.attemptId}:${tool}:${requestKey}`;
}

function findParent(call: OrchestrationCall) {
  const run = call.state().runs[call.runId];
  if (!run) throw new Error('This run no longer exists. End your turn.');
  return run;
}

function findChild(call: OrchestrationCall, delegationId: string): DelegatedRun {
  const child = call.state().runs[delegationId];
  if (!child || !isDelegatedRun(child) || child.delegation.parentRunId !== call.runId) {
    throw new Error(
      `You started no delegation ${delegationId}. Use the delegation_id that delegate_task returned.`
    );
  }
  return child;
}

function serializeStatus(state: ShinsaState, child: DelegatedRun, extra: { waitTimedOut?: boolean } = {}) {
  const status = resolveDelegationStatus(child);
  const question = child.delegation.question;
  const open = child.endedAt === null && question !== null && question.answer === null;
  return JSON.stringify(
    {
      delegation_id: child.id,
      title: child.delegation.title,
      role: child.role,
      status,
      provider: child.provider,
      model: child.model,
      depth: child.delegation.depth,
      isolation: child.delegation.isolation,
      has_pending_question: open,
      question: open
        ? { question: question.question, context: question.context, choices: question.choices }
        : null,
      delegations_running: listLiveChildRuns(state, child.id).length,
      result: child.endedAt === null ? null : child.summary,
      wait_timed_out: extra.waitTimedOut ?? false,
    },
    null,
    2
  );
}

async function acknowledge(call: OrchestrationCall, child: DelegatedRun) {
  await call.dispatch({
    type: 'agent.acknowledge_delegation',
    runId: call.runId,
    attemptId: call.attemptId,
    childRunId: child.id,
  });
  return findChild(call, child.id);
}

async function readStatus(
  call: OrchestrationCall,
  child: DelegatedRun,
  extra: { waitTimedOut?: boolean } = {}
) {
  const seen = await acknowledge(call, child);
  return serializeStatus(call.state(), seen, extra);
}

function selectRequested(call: OrchestrationCall, requestKey: string) {
  return listChildRuns(call.state(), call.runId).find((child) => child.delegation.requestKey === requestKey);
}

async function delegateTask(input: Record<string, unknown>, call: OrchestrationCall) {
  const request = assertProtocol(validateDelegationRequest(input));
  const parent = findParent(call);
  if (request.provider && !call.hasProvider(request.provider)) {
    throw new Error(
      `There is no agent provider "${request.provider}". Leave provider unset to use the default.`
    );
  }
  const requestKey = request.requestKey ?? call.requestKey;
  const known = selectRequested(call, requestKey);
  let baseCommit: string | null = null;
  if (request.isolation === 'worktree' && !known) baseCommit = await call.resolveBaseCommit();
  await call.dispatch(
    {
      type: 'agent.delegate',
      runId: call.runId,
      attemptId: call.attemptId,
      requestKey,
      title: request.title,
      brief: request.brief,
      role: request.role ?? resolveDefaultRole(parent),
      mode: request.mode,
      isolation: known?.delegation.isolation ?? request.isolation,
      baseCommit: known?.delegation.baseCommit ?? baseCommit,
      provider: request.provider,
      model: request.model,
    },
    resolveCommandId(call, 'delegate', request.requestKey)
  );
  const child = selectRequested(call, requestKey);
  if (!child) throw new Error('Nothing was delegated. Try again.');
  if (!known) call.recordStarted(child.id);
  if (request.mode === 'async') return serializeStatus(call.state(), child);
  const outcome = await call.awaitDelegation(child.id, request.timeoutMinutes * call.minuteMs, call.signal);
  if (outcome !== 'timeout') return readStatus(call, findChild(call, child.id));
  await call.dispatch({ type: 'delegation.wake_policy', runId: child.id, wake: 'always' });
  return serializeStatus(call.state(), findChild(call, child.id), { waitTimedOut: true });
}

async function cancelDelegation(input: Record<string, unknown>, call: OrchestrationCall) {
  const { delegationId } = assertProtocol(validateDelegationReference(input));
  findChild(call, delegationId);
  await call.dispatch({
    type: 'agent.cancel_delegation',
    runId: call.runId,
    attemptId: call.attemptId,
    childRunId: delegationId,
  });
  return serializeStatus(call.state(), findChild(call, delegationId));
}

async function answerDelegation(input: Record<string, unknown>, call: OrchestrationCall) {
  const { delegationId, answer } = assertProtocol(validateDelegationAnswer(input));
  findChild(call, delegationId);
  await call.dispatch({
    type: 'agent.answer_delegation',
    runId: call.runId,
    attemptId: call.attemptId,
    childRunId: delegationId,
    answer,
  });
  return 'Answered. The agent carries on, and its result arrives here when it finishes.';
}

async function resolveRepoId(call: OrchestrationCall, task: Task, name: string | null) {
  if (!name) return null;
  const state = call.state();
  const repo =
    Object.values(state.repos).find((candidate) => candidate.name === name) ??
    (await call.registerRepo(task, name));
  if (!repo) {
    const known = Object.values(state.repos).map((candidate) => candidate.name);
    throw new Error(
      `There is no repository "${name}" in Shinsa or in the project's folders. Known: ${known.join(', ') || 'none'}.`
    );
  }
  return repo.id === task.repoId ? null : repo.id;
}

function resolveForkOf(state: ShinsaState, reference: string | null) {
  if (reference === null) return {};
  return { forkOf: findForkSource(state, reference) };
}

function listLinks(tasks: Task[]) {
  return tasks
    .map((task) => `- [${task.title}](${serializeReference({ kind: 'task', id: task.id })})`)
    .join('\n');
}

function findTaskOf(call: OrchestrationCall, run: Run) {
  const task = call.state().tasks[run.taskId];
  if (!task) throw new Error('This task no longer exists. End your turn.');
  return task;
}

async function createCourier(input: Record<string, unknown>, call: OrchestrationCall) {
  const request = assertProtocol(validateCourierTask(input));
  const source = findTaskOf(call, findParent(call));
  const requestKey = request.requestKey ?? call.requestKey;
  const repoId = await resolveRepoId(call, source, request.repository);
  await call.dispatch(
    {
      type: 'agent.create_task',
      runId: call.runId,
      attemptId: call.attemptId,
      requestKey,
      request: request.request,
      repoId,
      ...resolveForkOf(call.state(), request.forkFrom),
      thisWaits: request.thisTaskWaits,
      afterThis: request.afterThis,
    },
    resolveCommandId(call, 'create_task', request.requestKey)
  );
  const created = Object.values(call.state().tasks).filter(
    (task) => task.createdBy?.taskId === source.id && task.createdBy.requestKey === requestKey
  );
  return `Created. Link it for the human with:\n${listLinks(created)}`;
}

async function splitPlan(input: Record<string, unknown>, call: OrchestrationCall) {
  const request = assertProtocol(validateSplit(input));
  const parent = findParent(call);
  await call.dispatch({
    type: 'agent.split_task',
    runId: call.runId,
    attemptId: call.attemptId,
    requests: request.requests,
    thisWaits: request.thisTaskWaits,
  });
  const state = call.state();
  const task = findTaskOf(call, parent);
  const split = task.splits?.find((entry) => entry.planVersion === (task.plan?.version ?? 0));
  const tasks = (split?.taskIds ?? []).flatMap((id) => state.tasks[id] ?? []);
  return `The plan is split into these tasks. Link them for the human with:\n${listLinks(tasks)}`;
}

async function readDelegation(input: Record<string, unknown>, call: OrchestrationCall) {
  const { delegationId } = assertProtocol(validateDelegationReference(input));
  const status = await readStatus(call, findChild(call, delegationId));
  return status;
}

export function handleOrchestrationTool(
  name: string,
  input: Record<string, unknown>,
  call: OrchestrationCall
): Promise<string | null> {
  switch (name) {
    case 'delegate_task':
      return delegateTask(input, call);
    case 'delegation_status':
      return readDelegation(input, call);
    case 'delegation_cancel':
      return cancelDelegation(input, call);
    case 'delegation_answer':
      return answerDelegation(input, call);
    case 'create_task':
      return createCourier(input, call);
    case 'split_task':
      return splitPlan(input, call);
    default:
      return Promise.resolve(null);
  }
}
