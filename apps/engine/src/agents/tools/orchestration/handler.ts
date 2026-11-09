import {
  type CourierRequest,
  type DelegatedRun,
  type DelegateRole,
  isDelegatedRun,
  listChildRuns,
  listLiveChildRuns,
  type Run,
  resolveDelegationStatus,
  SHAPE_LIMITS,
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
import { Duration, Effect, Option } from 'effect';
import { describeError } from '../../../log/index.ts';
import { HANDED_OVER } from '../../handover.ts';
import { assertToolInput } from '../attempts.ts';
import { type ForkReference, findStackParent, resolveForkReference } from '../forks.ts';
import { ToolCallFailed } from '../schema.ts';
import { DEFAULT_ROLE, type OrchestrationCall } from './schema.ts';

export const handleOrchestrationTool = Effect.fn('OrchestrationTool.handle')(function* (
  name: string,
  input: Record<string, unknown>,
  call: OrchestrationCall
) {
  const refuse = (message: string) => new ToolCallFailed({ message });

  const resolveDefaultRole = (parent: Run): DelegateRole =>
    parent.purpose === 'plan' ? 'planner' : DEFAULT_ROLE[parent.role];

  const resolveCommandId = (tool: string, requestKey: string | null) =>
    requestKey === null ? undefined : `agent:${call.runId}:${call.attemptId}:${tool}:${requestKey}`;

  const findParent = Effect.fn('OrchestrationTool.findParent')(function* () {
    const run = (yield* call.state).runs[call.runId];
    if (!run) return yield* refuse('This run no longer exists. End your turn.');
    return run;
  });

  const findChild = Effect.fn('OrchestrationTool.findChild')(function* (delegationId: string) {
    const child = (yield* call.state).runs[delegationId];
    if (!child || !isDelegatedRun(child) || child.delegation.parentRunId !== call.runId) {
      return yield* refuse(
        `You started no delegation ${delegationId}. Use the delegation_id that delegate_task returned.`
      );
    }
    return child;
  });

  const findTaskOf = Effect.fn('OrchestrationTool.findTaskOf')(function* (run: Run) {
    const task = (yield* call.state).tasks[run.taskId];
    if (!task) return yield* refuse('This task no longer exists. End your turn.');
    return task;
  });

  const serializeStatus = (state: ShinsaState, child: DelegatedRun, waitTimedOut = false) => {
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
        wait_timed_out: waitTimedOut,
      },
      null,
      2
    );
  };

  const readStatus = Effect.fn('OrchestrationTool.readStatus')(function* (child: DelegatedRun) {
    yield* call.dispatch({
      type: 'agent.acknowledge_delegation',
      runId: call.runId,
      attemptId: call.attemptId,
      childRunId: child.id,
    });
    const seen = yield* findChild(child.id);
    return serializeStatus(yield* call.state, seen);
  });

  const selectRequested = (state: ShinsaState, requestKey: string) =>
    listChildRuns(state, call.runId).find((child) => child.delegation.requestKey === requestKey);

  const resolveForkRepo = (fork: ForkReference | null, source: Task) =>
    fork?.kind !== 'teammate' || fork.repoId === source.repoId ? null : fork.repoId;

  const resolveForkFields = (fork: ForkReference | null) => {
    if (fork?.kind === 'own') return { forkOf: fork.forkOf };
    return fork ? { teammateFork: fork.teammateFork } : {};
  };

  const listLinks = (tasks: Task[]) =>
    tasks.map((task) => `- [${task.title}](${serializeReference({ kind: 'task', id: task.id })})`).join('\n');

  const delegateTask = Effect.fn('OrchestrationTool.delegateTask')(function* () {
    const request = yield* assertToolInput(validateDelegationRequest(input));
    const parent = yield* findParent();
    if (request.provider && !call.hasProvider(request.provider)) {
      return yield* refuse(
        `There is no agent provider "${request.provider}". Leave provider unset to use the default.`
      );
    }
    const requestKey = request.requestKey ?? call.requestKey;
    const known = selectRequested(yield* call.state, requestKey);
    const baseCommit = request.isolation === 'worktree' && !known ? yield* call.resolveBaseCommit : null;
    yield* call.dispatch(
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
      resolveCommandId('delegate', request.requestKey)
    );
    const child = selectRequested(yield* call.state, requestKey);
    if (!child) return yield* refuse('Nothing was delegated. Try again.');
    if (!known) yield* call.recordStarted(child.id);
    if (request.mode === 'async') return serializeStatus(yield* call.state, child);
    const outcome = yield* call.awaitDelegation(
      child.id,
      Duration.times(call.minute, request.timeoutMinutes),
      call.signal
    );
    if (outcome !== 'timeout') return yield* readStatus(yield* findChild(child.id));
    yield* call.dispatch({ type: 'delegation.wake_policy', runId: child.id, wake: 'always' });
    return serializeStatus(yield* call.state, yield* findChild(child.id), true);
  });

  const readDelegation = Effect.fn('OrchestrationTool.readDelegation')(function* () {
    const { delegationId } = yield* assertToolInput(validateDelegationReference(input));
    return yield* readStatus(yield* findChild(delegationId));
  });

  const cancelDelegation = Effect.fn('OrchestrationTool.cancelDelegation')(function* () {
    const { delegationId } = yield* assertToolInput(validateDelegationReference(input));
    yield* findChild(delegationId);
    yield* call.dispatch({
      type: 'agent.cancel_delegation',
      runId: call.runId,
      attemptId: call.attemptId,
      childRunId: delegationId,
    });
    return serializeStatus(yield* call.state, yield* findChild(delegationId));
  });

  const answerDelegation = Effect.fn('OrchestrationTool.answerDelegation')(function* () {
    const { delegationId, answer } = yield* assertToolInput(validateDelegationAnswer(input));
    yield* findChild(delegationId);
    yield* call.dispatch({
      type: 'agent.answer_delegation',
      runId: call.runId,
      attemptId: call.attemptId,
      childRunId: delegationId,
      answer,
    });
    return 'Answered. The agent carries on, and its result arrives here when it finishes.';
  });

  const findProjectId = Effect.fn('OrchestrationTool.findProjectId')(function* (reference: string) {
    const projects = Object.values((yield* call.state).projects);
    const project = selectProjectByReference(projects, reference);
    if (Option.isSome(project)) return project.value.id;
    const known = projects.map((candidate) => `${candidate.name} (${candidate.key})`);
    return yield* refuse(`There is no project "${reference}". Known: ${known.join(', ') || 'none'}.`);
  });

  const selectKnownRepo = (state: ShinsaState, repoName: string, projectId: string | null, named: boolean) =>
    Object.values(state.repos).find(
      (candidate) => candidate.name === repoName && (!named || candidate.projectId === projectId)
    ) ?? null;

  const createNewRepo = Effect.fn('OrchestrationTool.createNewRepo')(function* (
    projectId: string | null,
    repoName: string
  ) {
    if (!projectId) {
      return yield* refuse(
        'This task belongs to no project, so there is no folder to create the repository in. Name one with project.'
      );
    }
    return yield* call.createRepo(projectId, repoName);
  });

  const resolveRepo = Effect.fn('OrchestrationTool.resolveRepo')(function* (
    request: CourierRequest,
    repoName: string,
    projectId: string | null
  ) {
    const found =
      selectKnownRepo(yield* call.state, repoName, projectId, request.project !== null) ??
      (yield* call.registerRepo(projectId, repoName));
    if (found || !request.newRepository) return found;
    return yield* createNewRepo(projectId, repoName);
  });

  const resolveRepoId = Effect.fn('OrchestrationTool.resolveRepoId')(function* (
    task: Task,
    request: CourierRequest,
    projectId: string | null
  ) {
    const repoName = request.repository;
    if (!repoName) {
      if (request.newRepository)
        return yield* refuse('Set repository to the name of the repository to create.');
      return null;
    }
    const state = yield* call.state;
    const repo = yield* resolveRepo(request, repoName, projectId);
    if (!repo) {
      const known = Object.values(state.repos).map((candidate) => candidate.name);
      return yield* refuse(
        `There is no repository "${repoName}" in Shinsa or in the project's folders. Known: ${known.join(', ') || 'none'}. Set new_repository to create it.`
      );
    }
    return repo.id === task.repoId ? null : repo.id;
  });

  const resolveFork = Effect.fn('OrchestrationTool.resolveFork')(function* (reference: string | null) {
    const state = yield* call.state;
    const teamTasks = yield* call.teamTasks;
    return yield* Effect.try({
      try: () => resolveForkReference(state, teamTasks, reference),
      catch: (error) => refuse(describeError(error)),
    });
  });

  const resolveStackOn = Effect.fn('OrchestrationTool.resolveStackOn')(function* (
    references: readonly string[]
  ) {
    const state = yield* call.state;
    return yield* Effect.try({
      try: () => references.map((reference) => findStackParent(state, reference)),
      catch: (error) => refuse(describeError(error)),
    });
  });

  const createCourier = Effect.fn('OrchestrationTool.createCourier')(function* () {
    const request = yield* assertToolInput(validateCourierTask(input));
    const source = yield* findTaskOf(yield* findParent());
    const requestKey = request.requestKey ?? call.requestKey;
    const projectId = request.project
      ? yield* findProjectId(request.project)
      : Option.getOrNull(resolveTaskProject(yield* call.state, source));
    const fork = yield* resolveFork(request.forkFrom);
    const named = yield* resolveRepoId(source, request, projectId);
    const repoId = named ?? resolveForkRepo(fork, source);
    const stackOn = yield* resolveStackOn(request.stackOn);
    yield* call.dispatch(
      {
        type: 'agent.create_task',
        runId: call.runId,
        attemptId: call.attemptId,
        requestKey,
        request: request.request,
        repoId,
        ...(request.project && projectId ? { projectId } : {}),
        ...resolveForkFields(fork),
        thisWaits: request.thisTaskWaits,
        afterThis: request.afterThis,
        stackOnThis: request.stackOnThis,
        stackOn,
        backlog: request.backlog,
      },
      resolveCommandId('create_task', request.requestKey)
    );
    const created = Object.values((yield* call.state).tasks).filter(
      (task) => task.createdBy?.taskId === source.id && task.createdBy.requestKey === requestKey
    );
    return `Created. Link it for the human with:\n${listLinks(created)}`;
  });

  const splitPlan = Effect.fn('OrchestrationTool.splitPlan')(function* () {
    const request = yield* assertToolInput(validateSplit(input));
    const parent = yield* findParent();
    yield* call.dispatch({
      type: 'agent.split_task',
      runId: call.runId,
      attemptId: call.attemptId,
      requests: request.requests,
      thisWaits: request.thisTaskWaits,
      ...(request.stacked ? { stacked: true } : {}),
    });
    const state = yield* call.state;
    const task = yield* findTaskOf(parent);
    const split = task.splits?.find((entry) => entry.planVersion === (task.plan?.version ?? 0));
    const tasks = (split?.taskIds ?? []).flatMap((id) => state.tasks[id] ?? []);
    return `The plan is split into these tasks. Link them for the human with:\n${listLinks(tasks)}`;
  });

  const readMoveInput = Effect.fn('OrchestrationTool.readMoveInput')(function* () {
    const repository = typeof input.repository === 'string' ? input.repository.trim() : '';
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (!repository) return yield* refuse('Set repository to the name of the repository to move to.');
    if (!reason) return yield* refuse('Set reason to why the work belongs there, in one sentence.');
    if (reason.length > SHAPE_LIMITS.reason) {
      return yield* refuse(`reason is ${reason.length} characters; keep it to ${SHAPE_LIMITS.reason}.`);
    }
    return { repository, reason };
  });

  const moveToRepository = Effect.fn('OrchestrationTool.moveToRepository')(function* () {
    const { repository, reason } = yield* readMoveInput();
    const task = yield* findTaskOf(yield* findParent());
    const state = yield* call.state;
    const projectId = Option.getOrNull(resolveTaskProject(state, task));
    const repo =
      selectKnownRepo(state, repository, projectId, true) ??
      (yield* call.registerRepo(projectId, repository)) ??
      selectKnownRepo(state, repository, projectId, false);
    if (!repo) {
      const known = Object.values(state.repos)
        .filter((candidate) => candidate.projectId === projectId)
        .map((candidate) => candidate.name);
      return yield* refuse(
        `There is no repository "${repository}" in this task's project or its folders. Known: ${known.join(', ') || 'none'}.`
      );
    }
    yield* call.dispatch({ type: 'agent.move_to_repository', runId: call.runId, repoId: repo.id, reason });
    return HANDED_OVER;
  });

  switch (name) {
    case 'delegate_task':
      return yield* delegateTask();
    case 'delegation_status':
      return yield* readDelegation();
    case 'delegation_cancel':
      return yield* cancelDelegation();
    case 'delegation_answer':
      return yield* answerDelegation();
    case 'create_task':
      return yield* createCourier();
    case 'split_task':
      return yield* splitPlan();
    case 'move_to_repository':
      return yield* moveToRepository();
    default:
      return null;
  }
});
