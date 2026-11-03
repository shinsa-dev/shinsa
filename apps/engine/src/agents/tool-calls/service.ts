import {
  assertRunTool,
  isDelegatedRun,
  isTaskSettled,
  resolveCurrentRound,
  serializeTaskReferences,
  validateEvidenceRemoval,
  validateFixHandOver,
  validatePhaseHandOver,
  validatePlanHandOver,
  validateReview,
  type WatchdogSpec,
} from '@shinsa/core';
import { Clock, Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import {
  assertHeldSourcesUsed,
  assertProtocol,
  HANDED_OVER,
  readString,
  resolveCommitMessage,
} from '../handover.ts';
import { isSurfaceTool } from '../manage/index.ts';
import type { ServiceToolName } from '../services/schema.ts';
import { runServiceTool } from '../services/service.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import type {
  CommitHandOver,
  EffectCallDispatch,
  HandOverTool,
  ToolCall,
  ToolCallsDefinition,
  ToolCallsHandle,
} from './schema.ts';

export const makeToolCalls = (definition: ToolCallsDefinition) => {
  const { questions, work } = definition;

  const refuse = (message: string) => new ToolCallFailed({ message });

  const assertCalled = <T>(check: () => T) =>
    Effect.try({ try: check, catch: (error) => refuse(describeError(error)) });

  const createDispatch = ({ runId, attemptId, requestId }: ToolCall): EffectCallDispatch => {
    const sent = new Map<string, number>();
    return (command, id) => {
      if (id !== undefined) return definition.dispatch(command, { id });
      if (requestId === undefined) return definition.dispatch(command, undefined);
      const count = (sent.get(command.type) ?? 0) + 1;
      sent.set(command.type, count);
      const suffix = count === 1 ? command.type : `${command.type}:${count}`;
      return definition.dispatch(command, { id: `agent:${runId}:${attemptId}:call:${requestId}:${suffix}` });
    };
  };

  const findCurrent = Effect.fn('ToolCalls.findCurrent')(function* (runId: string, attemptId: string) {
    const state = yield* definition.state;
    const run = state.runs[runId];
    const task = run ? state.tasks[run.taskId] : undefined;
    if (!run || !task) return yield* refuse('This run no longer exists. End your turn.');
    if (run.endedAt !== null) return yield* refuse('This step is already over. End your turn.');
    if (run.attemptId && run.attemptId !== attemptId)
      return yield* refuse('A newer attempt of this step has taken over. End your turn.');
    return { run, task };
  });

  const commitThenDispatch = Effect.fn('ToolCalls.commitThenDispatch')(function* (
    call: ToolCall,
    command: CommitHandOver,
    dispatch: EffectCallDispatch
  ) {
    const { run, task } = yield* findCurrent(call.runId, call.attemptId);
    const repo = task.repoId ? (yield* definition.state).repos[task.repoId] : undefined;
    if (!task.worktreePath || !repo) return yield* dispatch({ ...command, treeHash: null });
    const commit = yield* definition.commit(repo, task, resolveCommitMessage(task, run));
    return yield* work.recordOverlaps(task.id, [], call.signal).pipe(
      Effect.andThen(dispatch({ ...command, treeHash: commit.treeHash, files: commit.files })),
      Effect.tapError(() => commit.undo)
    );
  });

  const assertSourcesUsed = Effect.fn('ToolCalls.assertSourcesUsed')(function* (
    call: ToolCall,
    watchdogs: readonly WatchdogSpec[] = []
  ) {
    if (!watchdogs.some((watchdog) => watchdog.sourceRequest)) return;
    const { run } = yield* findCurrent(call.runId, call.attemptId);
    const serverNames = yield* definition.listServerNames(run);
    yield* assertCalled(() => assertHeldSourcesUsed(watchdogs, serverNames));
  });

  const handOver = Effect.fn('ToolCalls.handOver')(function* (
    name: HandOverTool,
    call: ToolCall,
    dispatch: EffectCallDispatch
  ) {
    const { runId, attemptId, input } = call;
    switch (name) {
      case 'propose_plan': {
        const { document, reply } = yield* assertCalled(() => assertProtocol(validatePlanHandOver(input)));
        const { task } = yield* findCurrent(runId, attemptId);
        yield* work.recordOverlaps(
          task.id,
          document.files.map((file) => file.path),
          call.signal
        );
        yield* dispatch({ type: 'agent.propose_plan', runId, attemptId, document, reply });
        break;
      }
      case 'complete_phase': {
        const phase = yield* assertCalled(() => assertProtocol(validatePhaseHandOver(input)));
        yield* assertSourcesUsed(call, phase.walkthrough?.watchdogs);
        yield* commitThenDispatch(
          call,
          { type: 'agent.complete_phase', runId, attemptId, ...phase },
          dispatch
        );
        break;
      }
      case 'complete_fix': {
        const fix = yield* assertCalled(() => assertProtocol(validateFixHandOver(input)));
        yield* assertSourcesUsed(call, fix.walkthrough?.watchdogs);
        yield* commitThenDispatch(call, { type: 'agent.complete_fix', runId, attemptId, ...fix }, dispatch);
        break;
      }
      case 'report_review': {
        const review = yield* assertCalled(() => assertProtocol(validateReview(input)));
        yield* findCurrent(runId, attemptId);
        yield* dispatch({ type: 'agent.report_review', runId, attemptId, ...review });
        break;
      }
    }
    return HANDED_OVER;
  });

  const attachEvidence = Effect.fn('ToolCalls.attachEvidence')(function* (
    { runId, attemptId, input }: ToolCall,
    dispatch: EffectCallDispatch
  ) {
    const { task } = yield* findCurrent(runId, attemptId);
    const folder = { taskId: task.id, round: resolveCurrentRound(task).number };
    const evidence = yield* definition.storeEvidence(input, task.worktreePath, folder);
    yield* dispatch({ ...evidence, runId, attemptId });
    return 'Attached.';
  });

  const removeEvidence = Effect.fn('ToolCalls.removeEvidence')(function* (
    { runId, attemptId, input }: ToolCall,
    dispatch: EffectCallDispatch
  ) {
    const { items, reason } = yield* assertCalled(() => assertProtocol(validateEvidenceRemoval(input)));
    yield* findCurrent(runId, attemptId);
    yield* dispatch({ type: 'agent.remove_evidence', runId, attemptId, items, reason });
    return 'Removed.';
  });

  const readTask = Effect.fn('ToolCalls.readTask')(function* (input: Record<string, unknown>) {
    const taskId = readString(input, 'task_id');
    if (!taskId) return yield* refuse('task_id is required.');
    return yield* definition.readTask(taskId);
  });

  const runService = Effect.fn('ToolCalls.runService')(function* (
    name: ServiceToolName,
    { runId, attemptId, input }: ToolCall
  ) {
    const { run, task } = yield* findCurrent(runId, attemptId);
    yield* assertCalled(() => assertRunTool(run, name));
    if (!definition.services)
      return yield* refuse(`${name} is not available while Shinsa runs without terminals.`);
    return yield* runServiceTool(name, input, {
      state: yield* definition.state,
      task,
      runner: definition.services,
      now: yield* Clock.currentTimeMillis,
    });
  });

  const note = Effect.fn('ToolCalls.note')(function* (
    { runId, attemptId, input }: ToolCall,
    dispatch: EffectCallDispatch
  ) {
    const text = readString(input, 'note');
    if (!text) return yield* refuse('note is required.');
    yield* dispatch({ type: 'agent.note', runId, attemptId, note: text });
    return 'Noted.';
  });

  const manage = Effect.fn('ToolCalls.manage')(function* (
    name: string,
    { runId, attemptId, input, requestId }: ToolCall
  ) {
    const { run, task } = yield* findCurrent(runId, attemptId);
    if (!definition.manage || isDelegatedRun(run))
      return yield* refuse(`${name} is not available to this agent.`);
    const text = yield* definition.manage({ name, input, runId, attemptId, requestId, taskId: task.id });
    return isTaskSettled((yield* definition.state).tasks[task.id] ?? task)
      ? `${text} Stop here without a closing message.`
      : text;
  });

  const handleOther = Effect.fn('ToolCalls.handleOther')(function* (
    name: string,
    call: ToolCall,
    dispatch: EffectCallDispatch
  ) {
    const worktreePath = Effect.map(
      findCurrent(call.runId, call.attemptId),
      ({ task }) => task.worktreePath ?? ''
    );
    const reply = yield* definition.handleOther(name, call, { dispatch, worktreePath });
    if (reply === null) return yield* refuse(`Unknown tool ${name}.`);
    return reply;
  });

  const handle = Effect.fn('ToolCalls.handle')(function* (name: string, call: ToolCall) {
    const { runId, attemptId, input, signal } = call;
    const dispatch = createDispatch(call);
    switch (name) {
      case 'propose_plan':
      case 'complete_phase':
      case 'complete_fix':
      case 'report_review':
        return yield* handOver(name, call, dispatch);
      case 'ask':
        return yield* questions.ask(runId, attemptId, input, signal, dispatch);
      case 'request_secret':
        return yield* questions.requestSecret(runId, attemptId, input, signal, dispatch);
      case 'attach_evidence':
        return yield* attachEvidence(call, dispatch);
      case 'remove_evidence':
        return yield* removeEvidence(call, dispatch);
      case 'find_tasks':
        return serializeTaskReferences(yield* definition.state, readString(input, 'query') ?? '');
      case 'read_task':
        return yield* readTask(input);
      case 'list_repository_work':
        return yield* work.describe((yield* findCurrent(runId, attemptId)).task.id, signal);
      case 'note':
        return yield* note(call, dispatch);
      case 'list_services':
      case 'run_service':
      case 'add_service':
      case 'remove_service':
        return yield* runService(name, call);
      default:
        if (isSurfaceTool(name)) return yield* manage(name, call);
        return yield* handleOther(name, call, dispatch);
    }
  });

  const toolCalls: ToolCallsHandle = { handle };
  return Effect.succeed(toolCalls);
};
