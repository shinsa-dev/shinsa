import {
  type CourierRequest,
  type DelegatedRun,
  type DelegateRole,
  isDelegatedRun,
  listChildRuns,
  listLiveChildRuns,
  type Run,
  resolveDelegationStatus,
  resolveTaskProject,
  selectProjectByReference,
  type ShinsaState,
  serializeReference,
  type Task,
  validateCourierTask,
  validateDelegationAnswer,
  validateDelegationReference,
  validateDelegationRequest,
  validateSplit,
} from '@shinsa/core';
import { assertProtocol } from '../../handover.ts';
import { findForkSource } from '../forks.ts';
import { DEFAULT_ROLE, type OrchestrationCall } from './schema.ts';

function resolveDefaultRole(parent: Run): DelegateRole {
  return parent.purpose === 'plan' ? 'planner' : DEFAULT_ROLE[parent.role];
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

function findProjectId(state: ShinsaState, reference: string) {
  const projects = Object.values(state.projects);
  const project = selectProjectByReference(projects, reference);
  if (project) return project.id;
  const known = projects.map((candidate) => `${candidate.name} (${candidate.key})`);
  throw new Error(`There is no project "${reference}". Known: ${known.join(', ') || 'none'}.`);
}

function selectKnownRepo(state: ShinsaState, name: string, projectId: string | null, named: boolean) {
  return (
    Object.values(state.repos).find(
      (candidate) => candidate.name === name && (!named || candidate.projectId === projectId)
    ) ?? null
  );
}

async function createNewRepo(call: OrchestrationCall, projectId: string | null, name: string) {
  if (!projectId) {
    throw new Error(
      'This task belongs to no project, so there is no folder to create the repository in. Name one with project.'
    );
  }
  return await call.createRepo(projectId, name);
}

async function resolveRepo(
  call: OrchestrationCall,
  request: CourierRequest,
  name: string,
  projectId: string | null
) {
  const found =
    selectKnownRepo(call.state(), name, projectId, request.project !== null) ??
    (await call.registerRepo(projectId, name));
  if (found || !request.newRepository) return found;
  return await createNewRepo(call, projectId, name);
}

async function resolveRepoId(
  call: OrchestrationCall,
  task: Task,
  request: CourierRequest,
  projectId: string | null
) {
  const name = request.repository;
  if (!name) {
    if (request.newRepository) throw new Error('Set repository to the name of the repository to create.');
    return null;
  }
  const state = call.state();
  const repo = await resolveRepo(call, request, name, projectId);
  if (!repo) {
    const known = Object.values(state.repos).map((candidate) => candidate.name);
    throw new Error(
      `There is no repository "${name}" in Shinsa or in the project's folders. Known: ${known.join(', ') || 'none'}. Set new_repository to create it.`
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
  const projectId = request.project
    ? findProjectId(call.state(), request.project)
    : resolveTaskProject(call.state(), source);
  const repoId = await resolveRepoId(call, source, request, projectId);
  await call.dispatch(
    {
      type: 'agent.create_task',
      runId: call.runId,
      attemptId: call.attemptId,
      requestKey,
      request: request.request,
      repoId,
      ...(request.project && projectId ? { projectId } : {}),
      ...resolveForkOf(call.state(), request.forkFrom),
      thisWaits: request.thisTaskWaits,
      afterThis: request.afterThis,
      stackOnThis: request.stackOnThis,
      backlog: request.backlog,
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
