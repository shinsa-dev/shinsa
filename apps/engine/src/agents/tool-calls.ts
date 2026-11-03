import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { Checkout } from '../git/checkout/service.ts';
import { describeError } from '../log/index.ts';
import { createProjectRepository, upsertProjectFolderRepo } from '../repos/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { awaitDelegation } from './delegations/delivery.ts';
import { storeEvidence } from './handover.ts';
import { createManageClient, readSurfaceToolCall } from './manage/index.ts';
import { resolveTaskReading } from './reading/task.ts';
import { RepositoryWork } from './repository-work.ts';
import { createServiceRunner } from './services.ts';
import type { ToolCall, ToolCallsHandle, ToolCallsOptions } from './tool-calls/schema.ts';
import { makeToolCalls } from './tool-calls/service.ts';
import { handleOrchestrationTool } from './tools/orchestration/handler.ts';
import { handleProcessTool } from './tools/process/handler.ts';
import { ToolCallFailed } from './tools/schema.ts';

export type { ToolCall, ToolCallsOptions } from './tool-calls/schema.ts';

function refuse(error: unknown) {
  return error instanceof DomainError ? error : new ToolCallFailed({ message: describeError(error) });
}

function attempt<A>(run: () => Promise<A> | A) {
  return Effect.tryPromise({ try: () => Promise.resolve(run()), catch: refuse });
}

export class ToolCalls {
  readonly #handle: ToolCallsHandle;

  constructor(options: ToolCallsOptions) {
    const { engine, evidence, transcripts, providers, schedules, minuteMs, manage, workspaces } = options;
    this.#handle = edgeRuntime.runSync(
      makeToolCalls({
        state: Effect.sync(() => engine.state),
        dispatch: (command, dispatchOptions) => attempt(() => engine.dispatch(command, dispatchOptions)),
        questions: options.questions.handle,
        work: new RepositoryWork(engine).handle,
        services: options.services ? createServiceRunner(options.services) : null,
        commit: (repo, task, message) =>
          attempt(() => workspaces.resolve(task).commit(repo, task, message)).pipe(
            Effect.map((commit) => ({
              treeHash: commit.treeHash,
              files: commit.files,
              undo: attempt(() => commit.undo()),
            }))
          ),
        listServerNames: (run) => attempt(() => options.listServerNames(run)),
        storeEvidence: (input, worktreePath, folder) =>
          Effect.try({ try: () => storeEvidence(input, worktreePath, evidence, folder), catch: refuse }),
        readTask: (taskId) => Effect.sync(() => resolveTaskReading(engine.state, transcripts, taskId)),
        manage: manage
          ? ({ name, input, runId, attemptId, requestId, taskId }) =>
              Effect.try({ try: () => readSurfaceToolCall(name, input), catch: refuse }).pipe(
                Effect.flatMap((call) => {
                  const client = createManageClient({
                    engine,
                    base: manage.baseUrl(),
                    key: requestId === undefined ? null : `agent:${runId}:${attemptId}:call:${requestId}`,
                    byTask: taskId,
                    projects: manage.projects,
                    route: manage.route,
                    ...(manage.hookSecrets ? { hookSecrets: manage.hookSecrets(taskId) } : {}),
                  });
                  return Effect.mapError(call.spec.run(client, call.values), refuse);
                }),
                Effect.map(({ text }) => text)
              )
          : null,
        handleOther: (name, { runId, attemptId, input, signal, requestId }, helpers) => {
          const dispatch = (command: Parameters<typeof helpers.dispatch>[0], id?: string) =>
            edgeRuntime.runPromise(helpers.dispatch(command, id));
          const orchestrate = attempt(() =>
            handleOrchestrationTool(name, input, {
              runId,
              attemptId,
              requestKey: requestId === undefined ? Bun.randomUUIDv7() : `call:${attemptId}:${requestId}`,
              signal,
              minuteMs,
              state: () => engine.state,
              dispatch,
              resolveBaseCommit: () =>
                edgeRuntime.runPromise(
                  Effect.flatMap(helpers.worktreePath, (path) =>
                    Checkout.use((checkout) => checkout.head(path))
                  )
                ),
              registerRepo: (projectId, repoName) => upsertProjectFolderRepo(engine, projectId, repoName),
              createRepo: (projectId, repoName) => createProjectRepository(engine, projectId, repoName),
              hasProvider: (id) => providers.select(id) !== null,
              awaitDelegation: (childRunId, timeoutMs, waitSignal) =>
                awaitDelegation(engine, childRunId, timeoutMs, waitSignal),
              recordStarted: (childRunId) => {
                transcripts.record(runId, {
                  type: 'notice',
                  notice: { kind: 'delegation', event: 'started', runIds: [childRunId] },
                });
              },
            })
          );
          const schedule = attempt(
            () =>
              schedules?.handleTool(name, input, { runId, attemptId, state: () => engine.state, dispatch }) ??
              null
          );
          return attempt(() => handleProcessTool(name, input, { runId, attemptId, dispatch })).pipe(
            Effect.flatMap((reply) => (reply === null ? orchestrate : Effect.succeed(reply))),
            Effect.flatMap((reply) => (reply === null ? schedule : Effect.succeed(reply)))
          );
        },
      })
    );
  }

  handle(name: string, call: ToolCall): Promise<string> {
    return edgeRuntime.runPromise(this.#handle.handle(name, call));
  }
}
