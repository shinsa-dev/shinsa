import type { RequestId } from '@modelcontextprotocol/sdk/types.js';
import {
  type CommandOf,
  isDelegatedRun,
  isTaskSettled,
  type ShinsaCommand,
  type ShinsaEvent,
  serializeTaskReferences,
  validateFindings,
  validateFixHandOver,
  validatePhaseHandOver,
  validatePlanHandOver,
} from '@shinsa/core';
import { commitWorktree, resolveHead, resolveTree } from '../git/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { ScheduleToolCall } from '../schedules/index.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import type { EvidenceStore } from '../store/index.ts';
import { awaitDelegation } from './delegations.ts';
import { assertProtocol, HANDED_OVER, readString, resolveCommitMessage, storeEvidence } from './handover.ts';
import { createManageClient, isSurfaceTool, type ManageAccess, readSurfaceToolCall } from './manage/index.ts';
import type { ProviderRegistry } from './providers/index.ts';
import type { Questions } from './questions.ts';
import { resolveTaskReading } from './reading.ts';
import { handleOrchestrationTool } from './tools/orchestration.ts';
import { handleProcessTool } from './tools/process.ts';
import type { Transcripts } from './transcripts/index.ts';

export interface ScheduleToolHandler {
  handleTool: (
    name: string,
    input: Record<string, unknown>,
    call: ScheduleToolCall
  ) => Promise<string> | null;
}

interface ToolCallsOptions {
  engine: Engine;
  evidence: EvidenceStore;
  transcripts: Transcripts;
  providers: ProviderRegistry;
  questions: Questions;
  schedules: ScheduleToolHandler | null;
  minuteMs: number;
  manage: ManageAccess | null;
}

interface ToolCall {
  runId: string;
  attemptId: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  requestId?: RequestId;
}

type CallDispatch = (command: ShinsaCommand, id?: string) => Promise<ShinsaEvent[]>;

type CommitHandOver =
  | Omit<CommandOf<'agent.complete_phase'>, 'treeHash'>
  | Omit<CommandOf<'agent.complete_fix'>, 'treeHash'>;

type HandOverTool = 'propose_plan' | 'complete_phase' | 'complete_fix' | 'report_review';

export class ToolCalls {
  readonly #options: ToolCallsOptions;

  constructor(options: ToolCallsOptions) {
    this.#options = options;
  }

  handle(name: string, call: ToolCall): Promise<string> {
    const { runId, attemptId, input, signal } = call;
    const dispatch = this.#createDispatch(call);
    switch (name) {
      case 'propose_plan':
      case 'complete_phase':
      case 'complete_fix':
      case 'report_review':
        return this.#handOver(name, call, dispatch);
      case 'ask':
        return this.#options.questions.ask(runId, attemptId, input, signal, dispatch);
      case 'request_secret':
        return this.#options.questions.requestSecret(runId, attemptId, input, signal, dispatch);
      case 'attach_evidence':
        return this.#attachEvidence(call, dispatch);
      case 'find_tasks':
        return Promise.resolve(
          serializeTaskReferences(this.#options.engine.state, readString(input, 'query') ?? '')
        );
      case 'read_task':
        return this.#readTask(input);
      case 'note':
        return this.#note(call, dispatch);
      default:
        if (isSurfaceTool(name)) return this.#manage(name, call);
        return this.#handleOther(name, call, dispatch);
    }
  }

  #createDispatch({ runId, attemptId, requestId }: ToolCall): CallDispatch {
    const { engine } = this.#options;
    const sent = new Map<string, number>();
    return (command, id) => {
      if (id !== undefined) return engine.dispatch(command, { id });
      if (requestId === undefined) return engine.dispatch(command);
      const count = (sent.get(command.type) ?? 0) + 1;
      sent.set(command.type, count);
      const suffix = count === 1 ? command.type : `${command.type}:${count}`;
      return engine.dispatch(command, { id: `agent:${runId}:${attemptId}:call:${requestId}:${suffix}` });
    };
  }

  #findCurrent(runId: string, attemptId: string) {
    const state = this.#options.engine.state;
    const run = state.runs[runId];
    const task = run ? state.tasks[run.taskId] : undefined;
    if (!run || !task) throw new Error('This run no longer exists. End your turn.');
    if (run.endedAt !== null) throw new Error('This step is already over. End your turn.');
    if (run.attemptId && run.attemptId !== attemptId) {
      throw new Error('A newer attempt of this step has taken over. End your turn.');
    }
    return { run, task };
  }

  async #commitThenDispatch(call: ToolCall, command: CommitHandOver, dispatch: CallDispatch) {
    const { run, task } = this.#findCurrent(call.runId, call.attemptId);
    const path = task.worktreePath;
    if (!path) return dispatch({ ...command, treeHash: null });
    const before = await resolveHead(path);
    const committed = await commitWorktree(path, resolveCommitMessage(task, run));
    try {
      return await dispatch({ ...command, treeHash: await resolveTree(path) });
    } catch (error) {
      if (committed) await runCommandOrThrow(['git', 'reset', '--soft', before], path);
      throw error;
    }
  }

  async #handOver(name: HandOverTool, call: ToolCall, dispatch: CallDispatch) {
    const { runId, attemptId, input } = call;
    switch (name) {
      case 'propose_plan': {
        const { document, changeSummary } = assertProtocol(validatePlanHandOver(input));
        this.#findCurrent(runId, attemptId);
        await dispatch({ type: 'agent.propose_plan', runId, attemptId, document, changeSummary });
        break;
      }
      case 'complete_phase': {
        const handOver = assertProtocol(validatePhaseHandOver(input));
        await this.#commitThenDispatch(
          call,
          { type: 'agent.complete_phase', runId, attemptId, ...handOver },
          dispatch
        );
        break;
      }
      case 'complete_fix': {
        const { summary } = assertProtocol(validateFixHandOver(input));
        await this.#commitThenDispatch(
          call,
          { type: 'agent.complete_fix', runId, attemptId, summary },
          dispatch
        );
        break;
      }
      case 'report_review': {
        const findings = assertProtocol(validateFindings(input));
        this.#findCurrent(runId, attemptId);
        await dispatch({ type: 'agent.report_review', runId, attemptId, findings });
        break;
      }
    }
    return HANDED_OVER;
  }

  async #attachEvidence({ runId, attemptId, input }: ToolCall, dispatch: CallDispatch) {
    const { task } = this.#findCurrent(runId, attemptId);
    const evidence = storeEvidence(input, task.worktreePath, this.#options.evidence);
    await dispatch({ type: 'agent.attach_evidence', runId, attemptId, ...evidence });
    return 'Attached.';
  }

  #readTask(input: Record<string, unknown>) {
    const { engine, transcripts } = this.#options;
    const taskId = readString(input, 'task_id');
    if (!taskId) return Promise.reject(new Error('task_id is required.'));
    return Promise.resolve(resolveTaskReading(engine.state, transcripts, taskId));
  }

  async #note({ runId, attemptId, input }: ToolCall, dispatch: CallDispatch) {
    const note = readString(input, 'note');
    if (!note) throw new Error('note is required.');
    await dispatch({ type: 'agent.note', runId, attemptId, note });
    return 'Noted.';
  }

  async #manage(name: string, { runId, attemptId, input, requestId }: ToolCall) {
    const { engine, manage } = this.#options;
    const { run, task } = this.#findCurrent(runId, attemptId);
    if (!manage || isDelegatedRun(run)) throw new Error(`${name} is not available to this agent.`);
    const call = readSurfaceToolCall(name, input);
    const client = createManageClient({
      engine,
      base: manage.baseUrl(),
      key: requestId === undefined ? null : `agent:${runId}:${attemptId}:call:${requestId}`,
      byTask: task.id,
      projects: manage.projects,
      route: manage.route,
    });
    const { text } = await call.spec.run(client, call.values);
    return isTaskSettled(engine.state.tasks[task.id] ?? task)
      ? `${text} Stop here without a closing message.`
      : text;
  }

  async #handleOther(name: string, call: ToolCall, dispatch: CallDispatch) {
    const { runId, attemptId, input } = call;
    const reply =
      (await handleProcessTool(name, input, { runId, attemptId, dispatch })) ??
      (await this.#handleOrchestration(name, call, dispatch)) ??
      (await this.#handleSchedules(name, call, dispatch));
    if (reply === null) throw new Error(`Unknown tool ${name}.`);
    return reply;
  }

  #handleOrchestration(
    name: string,
    { runId, attemptId, input, signal, requestId }: ToolCall,
    dispatch: CallDispatch
  ) {
    const { engine, transcripts, providers, minuteMs } = this.#options;
    return handleOrchestrationTool(name, input, {
      runId,
      attemptId,
      requestKey: requestId === undefined ? Bun.randomUUIDv7() : `call:${attemptId}:${requestId}`,
      signal,
      minuteMs,
      state: () => engine.state,
      dispatch,
      resolveBaseCommit: () => resolveHead(this.#findCurrent(runId, attemptId).task.worktreePath ?? ''),
      hasProvider: (id) => providers.select(id) !== null,
      awaitDelegation: (childRunId, timeoutMs, waitSignal) =>
        awaitDelegation(engine, childRunId, timeoutMs, waitSignal),
      recordStarted: (childRunId) => {
        transcripts.record(runId, {
          type: 'notice',
          notice: { kind: 'delegation', event: 'started', runIds: [childRunId] },
        });
      },
    });
  }

  #handleSchedules(name: string, { runId, attemptId, input }: ToolCall, dispatch: CallDispatch) {
    const { schedules, engine } = this.#options;
    if (!schedules) return null;
    return schedules.handleTool(name, input, {
      runId,
      attemptId,
      state: () => engine.state,
      dispatch,
    });
  }
}
