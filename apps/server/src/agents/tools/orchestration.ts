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
import type { ToolSpec } from './schema.ts';

const L = DELEGATION_LIMITS;

const DEFAULT_ROLE: Record<RunRole, DelegateRole> = {
  triage: 'planner',
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  fixer: 'fixer',
  shipper: 'fixer',
  answerer: 'planner',
  investigator: 'builder',
  researcher: 'planner',
  operator: 'builder',
};

const TASK_ID = {
  type: 'string',
  maxLength: DELEGATION_LIMITS.name,
  description: 'The task_id that `delegate_task` returned.',
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
      'Hand one self-contained piece of work to another agent and get its result back. It starts from the `task` you give it alone, without this conversation, so put everything it needs in it.',
      'Use it for work that is independent of yours or should run in parallel: research, a second opinion, an isolated experiment, a review of what you built.',
      `mode "async" (the default) returns at once; the result arrives in this conversation when the agent finishes, steered into your turn or waking you after it ends, so carry on or end your turn instead of polling. mode "wait" blocks until the result, a question from the agent, or timeout_minutes (${L.waitMinutes} by default); a wait that times out does not stop the agent, and its result still arrives here.`,
      'For every review round, call delegate_task again with the original brief, the earlier findings, your responses and the open objections, under a new client_request_id.',
      'An agent that cannot change files can only delegate to the planner and reviewer roles. isolation "worktree" gives the agent its own checkout of your last commit; your uncommitted edits are not in it.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        task: {
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
            'planner investigates without changing files, reviewer reviews without changing files, builder and fixer change files. Defaults to your own role.',
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
      required: ['task'],
    },
  },
  delegation_status: {
    name: 'delegation_status',
    description:
      'Read a task you delegated: its status, its open question, and its result once it has one. Reading a finished result counts as receiving it, so it is not delivered to you again. Do not poll: results arrive by themselves.',
    inputSchema: { type: 'object', properties: { task_id: TASK_ID }, required: ['task_id'] },
  },
  delegation_cancel: {
    name: 'delegation_cancel',
    description:
      'Stop a task you delegated, and every task it delegated in turn. You get no report for it. A finished task stays as it is.',
    inputSchema: { type: 'object', properties: { task_id: TASK_ID }, required: ['task_id'] },
  },
  delegation_answer: {
    name: 'delegation_answer',
    description:
      'Answer the question a task you delegated is waiting on. When only the human can decide, ask them with `ask` first, then answer here.',
    inputSchema: {
      type: 'object',
      properties: { task_id: TASK_ID, answer: { type: 'string', maxLength: L.answer } },
      required: ['task_id', 'answer'],
    },
  },
  create_task: {
    name: 'create_task',
    description:
      'Create a new task on the roadmap for work outside this one, for example the same change in another repository. It starts at once and ends at the human’s review like any task. Whoever picks it up sees nothing of this task, so the request must stand on its own. Set this_task_waits only when this task cannot be merged before that one.',
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
        this_task_waits: { type: 'boolean' },
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

function findChild(call: OrchestrationCall, taskId: string): DelegatedRun {
  const child = call.state().runs[taskId];
  if (!child || !isDelegatedRun(child) || child.delegation.parentRunId !== call.runId) {
    throw new Error(`No task ${taskId} was delegated by you. Use the task_id that delegate_task returned.`);
  }
  return child;
}

function serializeStatus(state: ShinsaState, child: DelegatedRun, extra: { waitTimedOut?: boolean } = {}) {
  const status = resolveDelegationStatus(child);
  const question = child.delegation.question;
  const open = child.endedAt === null && question !== null && question.answer === null;
  return JSON.stringify(
    {
      task_id: child.id,
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
      delegated_tasks_running: listLiveChildRuns(state, child.id).length,
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
      `Shinsa has no agent provider "${request.provider}". Leave provider unset to use the default.`
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
      role: request.role ?? DEFAULT_ROLE[parent.role],
      mode: request.mode,
      isolation: known?.delegation.isolation ?? request.isolation,
      baseCommit: known?.delegation.baseCommit ?? baseCommit,
      provider: request.provider,
      model: request.model,
    },
    resolveCommandId(call, 'delegate', request.requestKey)
  );
  const child = selectRequested(call, requestKey);
  if (!child) throw new Error('The task was not delegated. Try again.');
  if (!known) call.recordStarted(child.id);
  if (request.mode === 'async') return serializeStatus(call.state(), child);
  const outcome = await call.awaitDelegation(child.id, request.timeoutMinutes * call.minuteMs, call.signal);
  if (outcome !== 'timeout') return readStatus(call, findChild(call, child.id));
  await call.dispatch({ type: 'delegation.wake_policy', runId: child.id, wake: 'always' });
  return serializeStatus(call.state(), findChild(call, child.id), { waitTimedOut: true });
}

async function cancelTask(input: Record<string, unknown>, call: OrchestrationCall) {
  const { taskId } = assertProtocol(validateDelegationReference(input));
  findChild(call, taskId);
  await call.dispatch({
    type: 'agent.cancel_delegation',
    runId: call.runId,
    attemptId: call.attemptId,
    childRunId: taskId,
  });
  return serializeStatus(call.state(), findChild(call, taskId));
}

async function answerTask(input: Record<string, unknown>, call: OrchestrationCall) {
  const { taskId, answer } = assertProtocol(validateDelegationAnswer(input));
  findChild(call, taskId);
  await call.dispatch({
    type: 'agent.answer_delegation',
    runId: call.runId,
    attemptId: call.attemptId,
    childRunId: taskId,
    answer,
  });
  return 'Answered. The delegated agent carries on, and its result arrives here when it finishes.';
}

function resolveRepoId(state: ShinsaState, task: Task, name: string | null) {
  if (!name) return null;
  const repo = Object.values(state.repos).find((candidate) => candidate.name === name);
  if (!repo) {
    const known = Object.values(state.repos).map((candidate) => candidate.name);
    throw new Error(`Shinsa knows no repository "${name}". Known: ${known.join(', ') || 'none'}.`);
  }
  return repo.id === task.repoId ? null : repo.id;
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
  await call.dispatch(
    {
      type: 'agent.create_task',
      runId: call.runId,
      attemptId: call.attemptId,
      requestKey,
      intent: request.intent,
      repoId: resolveRepoId(call.state(), source, request.repository),
      thisWaits: request.thisTaskWaits,
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
    intents: request.intents,
    thisWaits: request.thisTaskWaits,
  });
  const state = call.state();
  const task = findTaskOf(call, parent);
  const split = task.splits?.find((entry) => entry.planVersion === (task.spec?.version ?? 0));
  const tasks = (split?.taskIds ?? []).flatMap((id) => state.tasks[id] ?? []);
  return `The plan is split into these tasks. Link them for the human with:\n${listLinks(tasks)}`;
}

async function statusTask(input: Record<string, unknown>, call: OrchestrationCall) {
  const { taskId } = assertProtocol(validateDelegationReference(input));
  const status = await readStatus(call, findChild(call, taskId));
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
      return statusTask(input, call);
    case 'delegation_cancel':
      return cancelTask(input, call);
    case 'delegation_answer':
      return answerTask(input, call);
    case 'create_task':
      return createCourier(input, call);
    case 'split_task':
      return splitPlan(input, call);
    default:
      return Promise.resolve(null);
  }
}
