import {
  assertRunTool,
  DomainError,
  isDelegatedRun,
  isTaskSettled,
  resolveCurrentRound,
  serializeTaskReferences,
  serializeTeamTaskReferences,
  validateEvidenceRemoval,
  validateFixHandOver,
  validatePhaseHandOver,
  validatePlanHandOver,
  validateReview,
  type ShinsaCommand,
  type WatchdogSpec,
} from '@shinsa/core';
import { Clock, Context, Effect, FileSystem, Layer, Option, type Result } from 'effect';
import { Checkout } from '../../git/checkout/service.ts';
import { provideTaskGitHub } from '../../github/identity/resolve.ts';
import { MachineGitHub } from '../../github/identity/schema.ts';
import { describeError } from '../../log/index.ts';
import { RepoRegistry } from '../../repos/registry/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { ScheduleToolRefused, type ScheduleToolRun } from '../../schedules/tools/schema.ts';
import { ScheduleTools } from '../../schedules/tools/service.ts';
import { Evidence } from '../../store/evidence/service.ts';
import { Terminals } from '../../terminals/service.ts';
import { Workspaces } from '../../workspaces/service.ts';
import { LiveRuns } from '../active/service.ts';
import { awaitDelegation } from '../delegations/delivery.ts';
import { storeEvidence } from '../evidence.ts';
import {
  assertHeldSourcesUsed,
  HANDED_OVER,
  readString,
  resolveCommitMessage,
  resolveHandOver,
} from '../handover.ts';
import { createManageClient, isSurfaceTool, ManageAccess, readSurfaceToolCall } from '../manage/index.ts';
import { Providers } from '../providers/index.ts';
import { Questions } from '../questions/service.ts';
import { resolveTaskReading } from '../reading/task.ts';
import { RepositoryWork } from '../repository-work/service.ts';
import type { ServiceToolName } from '../services/schema.ts';
import { runServiceTool } from '../services/service.ts';
import { handleOrchestrationTool } from '../tools/orchestration/handler.ts';
import { handleProcessTool } from '../tools/process/handler.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import { Transcripts } from '../transcripts/service.ts';
import {
  type CommitHandOver,
  DelegationMinute,
  TeammateTasks,
  type EffectCallDispatch,
  type HandOverTool,
  type ToolCall,
} from './schema.ts';

export class ToolCalls extends Context.Service<
  ToolCalls,
  {
    readonly handle: (name: string, call: ToolCall) => Effect.Effect<string, ToolCallFailed | DomainError>;
  }
>()('shinsa/engine/agents/tool-calls/ToolCalls') {
  static readonly layer = Layer.effect(
    ToolCalls,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const questions = yield* Questions;
      const work = yield* RepositoryWork;
      const runs = yield* LiveRuns;
      const transcripts = yield* Transcripts;
      const evidence = yield* Evidence;
      const providers = yield* Providers;
      const workspaces = yield* Workspaces;
      const checkout = yield* Checkout;
      const registry = yield* RepoRegistry;
      const minute = yield* DelegationMinute;
      const teamTasks = yield* TeammateTasks;
      const services = yield* Effect.serviceOption(Terminals);
      const schedules = yield* Effect.serviceOption(ScheduleTools);
      const access = yield* Effect.serviceOption(ManageAccess);
      const machine = yield* MachineGitHub;

      const refuse = (message: string) => new ToolCallFailed({ message });

      const fail = (error: unknown) =>
        error instanceof DomainError ? error : new ToolCallFailed({ message: describeError(error) });

      const dispatchCommand = (command: ShinsaCommand, options: { id: string } | undefined) =>
        engine
          .dispatch(command, options)
          .pipe(Effect.catchTag('EngineStopped', (stopped) => refuse(stopped.message)));

      const assertCalled = <T>(check: () => T) =>
        Effect.try({ try: check, catch: (error) => refuse(describeError(error)) });

      const readCalled = <T, E>(result: Result.Result<T, E>) =>
        Effect.fromResult(result).pipe(Effect.mapError((error) => refuse(describeError(error))));

      const createDispatch = ({ runId, attemptId, requestId }: ToolCall): EffectCallDispatch => {
        const sent = new Map<string, number>();
        return (command, id) => {
          if (id !== undefined) return dispatchCommand(command, { id });
          if (requestId === undefined) return dispatchCommand(command, undefined);
          const count = (sent.get(command.type) ?? 0) + 1;
          sent.set(command.type, count);
          const suffix = count === 1 ? command.type : `${command.type}:${count}`;
          return dispatchCommand(command, { id: `agent:${runId}:${attemptId}:call:${requestId}:${suffix}` });
        };
      };

      const findCurrent = Effect.fn('ToolCalls.findCurrent')(function* (runId: string, attemptId: string) {
        const state = yield* engine.state;
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
        const repo = task.repoId ? (yield* engine.state).repos[task.repoId] : undefined;
        if (!task.worktreePath || !repo) return yield* dispatch({ ...command, treeHash: null });
        const commit = yield* Effect.mapError(
          workspaces
            .resolve(task)
            .commit(repo, task, resolveCommitMessage(task, run))
            .pipe(provideTaskGitHub(machine, engine.state, task.id)),
          fail
        );
        return yield* work.recordOverlaps(task.id, [], call.signal).pipe(
          Effect.andThen(dispatch({ ...command, treeHash: commit.treeHash, files: commit.files })),
          Effect.tapError(() => Effect.mapError(commit.undo, fail))
        );
      });

      const assertSourcesUsed = Effect.fn('ToolCalls.assertSourcesUsed')(function* (
        call: ToolCall,
        watchdogs: readonly WatchdogSpec[] = []
      ) {
        if (!watchdogs.some((watchdog) => watchdog.sourceRequest)) return;
        const { run } = yield* findCurrent(call.runId, call.attemptId);
        const serverNames = yield* runs.listServerNames(run);
        yield* readCalled(assertHeldSourcesUsed(watchdogs, serverNames));
      });

      const handOver = Effect.fn('ToolCalls.handOver')(function* (
        name: HandOverTool,
        call: ToolCall,
        dispatch: EffectCallDispatch
      ) {
        const { runId, attemptId, input } = call;
        switch (name) {
          case 'propose_plan': {
            const { document, reply, actions } = yield* readCalled(
              resolveHandOver(validatePlanHandOver(input))
            );
            const { task } = yield* findCurrent(runId, attemptId);
            yield* work.recordOverlaps(
              task.id,
              document.files.map((file) => file.path),
              call.signal
            );
            yield* dispatch({ type: 'agent.propose_plan', runId, attemptId, document, reply, actions });
            break;
          }
          case 'complete_phase': {
            const phase = yield* readCalled(resolveHandOver(validatePhaseHandOver(input)));
            yield* assertSourcesUsed(call, phase.walkthrough?.watchdogs);
            yield* commitThenDispatch(
              call,
              { type: 'agent.complete_phase', runId, attemptId, ...phase },
              dispatch
            );
            break;
          }
          case 'complete_fix': {
            const fix = yield* readCalled(resolveHandOver(validateFixHandOver(input)));
            yield* assertSourcesUsed(call, fix.walkthrough?.watchdogs);
            yield* commitThenDispatch(
              call,
              { type: 'agent.complete_fix', runId, attemptId, ...fix },
              dispatch
            );
            break;
          }
          case 'report_review': {
            const review = yield* readCalled(resolveHandOver(validateReview(input)));
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
        const stored = yield* withFiles(storeEvidence(input, task.worktreePath, evidence, folder)).pipe(
          Effect.catchDefect(Effect.fail),
          Effect.mapError(fail)
        );
        yield* dispatch({ ...stored, runId, attemptId });
        return 'Attached.';
      });

      const removeEvidence = Effect.fn('ToolCalls.removeEvidence')(function* (
        { runId, attemptId, input }: ToolCall,
        dispatch: EffectCallDispatch
      ) {
        const { items, reason } = yield* readCalled(resolveHandOver(validateEvidenceRemoval(input)));
        yield* findCurrent(runId, attemptId);
        yield* dispatch({ type: 'agent.remove_evidence', runId, attemptId, items, reason });
        return 'Removed.';
      });

      const readTask = Effect.fn('ToolCalls.readTask')(function* (input: Record<string, unknown>) {
        const taskId = readString(input, 'task_id');
        if (!taskId) return yield* refuse('task_id is required.');
        return yield* resolveTaskReading(yield* engine.state, transcripts, taskId);
      });

      const runService = Effect.fn('ToolCalls.runService')(function* (
        name: ServiceToolName,
        { runId, attemptId, input }: ToolCall
      ) {
        const { run, task } = yield* findCurrent(runId, attemptId);
        yield* assertCalled(() => assertRunTool(run, name));
        if (Option.isNone(services))
          return yield* refuse(`${name} is not available while Shinsa runs without terminals.`);
        const context = {
          state: yield* engine.state,
          task,
          runner: services.value,
          now: yield* Clock.currentTimeMillis,
        };
        return yield* withFiles(runServiceTool(name, input, context));
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
        if (Option.isNone(access) || isDelegatedRun(run))
          return yield* refuse(`${name} is not available to this agent.`);
        const { spec, values } = yield* Effect.fromResult(readSurfaceToolCall(name, input));
        const managed = access.value;
        const client = createManageClient({
          engine,
          base: managed.baseUrl(),
          key: requestId === undefined ? null : `agent:${runId}:${attemptId}:call:${requestId}`,
          byTask: task.id,
          projects: managed.projects,
          route: managed.route,
          ...(managed.hookSecrets ? { hookSecrets: managed.hookSecrets(task.id) } : {}),
        });
        const { text } = yield* Effect.mapError(spec.run(client, values), fail);
        return isTaskSettled((yield* engine.state).tasks[task.id] ?? task)
          ? `${text} Stop here without a closing message.`
          : text;
      });

      const scheduleRun = (call: ToolCall, dispatch: EffectCallDispatch): ScheduleToolRun => ({
        runId: call.runId,
        attemptId: call.attemptId,
        state: engine.state,
        dispatch: (command) =>
          dispatch(command).pipe(
            Effect.catchTag(
              'ToolCallFailed',
              (failed) => new ScheduleToolRefused({ message: failed.message })
            )
          ),
      });

      const handleSchedule = Effect.fn('ToolCalls.handleSchedule')(function* (
        name: string,
        call: ToolCall,
        dispatch: EffectCallDispatch
      ) {
        if (Option.isNone(schedules)) return null;
        const tool = schedules.value.handle(name, call.input, scheduleRun(call, dispatch));
        if (!tool) return null;
        return yield* tool.pipe(Effect.catchTag('ScheduleToolRefused', (refused) => refuse(refused.message)));
      });

      const findTasks = Effect.fn('ToolCalls.findTasks')(function* (query: string) {
        const own = serializeTaskReferences(yield* engine.state, query);
        const theirs = serializeTeamTaskReferences(yield* teamTasks, query);
        return theirs ? `${own}\n\n${theirs}` : own;
      });

      const orchestrate = (name: string, call: ToolCall, dispatch: EffectCallDispatch) => {
        const { runId, attemptId, input, signal, requestId } = call;
        const worktreePath = Effect.map(findCurrent(runId, attemptId), ({ task }) => task.worktreePath ?? '');
        return handleOrchestrationTool(name, input, {
          runId,
          attemptId,
          requestKey: requestId === undefined ? Bun.randomUUIDv7() : `call:${attemptId}:${requestId}`,
          signal,
          minute,
          state: engine.state,
          teamTasks,
          dispatch,
          resolveBaseCommit: worktreePath.pipe(
            Effect.flatMap((path) => Effect.mapError(checkout.head(path), fail))
          ),
          registerRepo: (projectId, repoName) =>
            Effect.mapError(registry.upsertProjectFolder(projectId, repoName), fail),
          createRepo: (projectId, repoName) =>
            Effect.mapError(registry.createInProject(projectId, repoName), fail),
          hasProvider: (id) => providers.select(id) !== null,
          awaitDelegation: (childRunId, timeout, waitSignal) =>
            awaitDelegation(childRunId, timeout, waitSignal).pipe(Effect.provideService(EngineCore, engine)),
          recordStarted: (childRunId) =>
            transcripts.record(runId, {
              type: 'notice',
              notice: { kind: 'delegation', event: 'started', runIds: [childRunId] },
            }),
        });
      };

      const handleOther = Effect.fn('ToolCalls.handleOther')(function* (
        name: string,
        call: ToolCall,
        dispatch: EffectCallDispatch
      ) {
        const reply =
          (yield* handleProcessTool(name, call.input, {
            runId: call.runId,
            attemptId: call.attemptId,
            dispatch,
          })) ??
          (yield* orchestrate(name, call, dispatch)) ??
          (yield* handleSchedule(name, call, dispatch));
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
          case 'request_browser_sign_in':
            return yield* questions.requestBrowserSignIn(runId, attemptId, input, signal, dispatch);
          case 'attach_evidence':
            return yield* attachEvidence(call, dispatch);
          case 'remove_evidence':
            return yield* removeEvidence(call, dispatch);
          case 'find_tasks':
            return yield* findTasks(readString(input, 'query') ?? '');
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

      return ToolCalls.of({ handle });
    })
  );
}
