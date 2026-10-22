import {
  isTaskSettled,
  listActiveRuns,
  listOpenGates,
  type Run,
  resolveAnswerPrompt,
  resolveContinuePrompt,
  serializeTaskReferences,
  validateFindings,
  validateFixHandOver,
  validatePhaseHandOver,
  validateSpecDocument,
} from '@shinsa/core';
import type { ServerConfig } from '../config/index.ts';
import { commitWorktree, stashEdits } from '../git/index.ts';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { EvidenceStore } from '../store/index.ts';
import {
  type ClaudeSession,
  type ClaudeSessionInput,
  type ClaudeSessionResult,
  startClaudeSession,
} from './claude/index.ts';
import { RunClock } from './clock.ts';
import { assertProtocol, HANDED_OVER, readString, resolveCommitMessage, storeEvidence } from './handover.ts';
import { createShinsaToolServer, type ToolHandler } from './tools/index.ts';
import type { Transcripts } from './transcripts/index.ts';

export type SessionStarter = (input: ClaudeSessionInput) => ClaudeSession;

export interface SupervisorOptions {
  startSession?: SessionStarter;
  maxRunMs?: number;
  quiesceMs?: number;
}

type QuestionWaiter = (answer: string | null) => void;

interface ActiveRun {
  taskId: string;
  done: Promise<void>;
  session: ClaudeSession | null;
  clock: RunClock | null;
}

const MAX_RUN_MS = 2 * 60 * 60 * 1000;

const QUIESCE_MS = 60_000;

const READ_ONLY_ROLES = new Set<Run['role']>(['planner', 'reviewer']);

export class RunSupervisor {
  readonly #engine: Engine;
  readonly #config: ServerConfig;
  readonly #transcripts: Transcripts;
  readonly #evidence: EvidenceStore;
  readonly #active = new Map<string, ActiveRun>();
  readonly #questions = new Map<string, QuestionWaiter>();
  readonly #startSession: SessionStarter;
  readonly #maxRunMs: number;
  readonly #quiesceMs: number;

  constructor(
    engine: Engine,
    config: ServerConfig,
    transcripts: Transcripts,
    evidence: EvidenceStore,
    options: SupervisorOptions = {}
  ) {
    this.#engine = engine;
    this.#config = config;
    this.#transcripts = transcripts;
    this.#evidence = evidence;
    this.#startSession = options.startSession ?? startClaudeSession;
    this.#maxRunMs = options.maxRunMs ?? MAX_RUN_MS;
    this.#quiesceMs = options.quiesceMs ?? QUIESCE_MS;
  }

  async execute(runId: string, override: string | null = null) {
    const state = this.#engine.state;
    const run = state.runs[runId];
    if (!run || run.endedAt !== null || this.#active.has(runId)) return;
    const task = state.tasks[run.taskId];
    const repo = task?.repoId ? state.repos[task.repoId] : undefined;
    if (!task?.worktreePath || !repo) {
      await this.#end(runId, { outcome: 'failed', summary: 'The task has no worktree to run in.' });
      return;
    }
    const released = Promise.withResolvers<void>();
    const active: ActiveRun = { taskId: task.id, done: released.promise, session: null, clock: null };
    this.#active.set(runId, active);
    let result: ClaudeSessionResult;
    try {
      await this.quiesce(task.id, runId);
      if (this.#engine.state.runs[runId]?.endedAt !== null) return;
      result = await this.#drive(run, task.worktreePath, repo.defaultBranch, override, active);
      if (READ_ONLY_ROLES.has(run.role)) await this.#discardEdits(task.worktreePath, run.role);
    } finally {
      this.#active.delete(runId);
      released.resolve();
    }
    await this.#end(runId, result);
  }

  async #drive(
    run: Run,
    cwd: string,
    defaultBranch: string,
    override: string | null,
    active: ActiveRun
  ): Promise<ClaudeSessionResult> {
    let timedOut = false;
    try {
      const handleTool: ToolHandler = (name, input, signal) => this.#handleTool(run.id, name, input, signal);
      this.#transcripts.record(run.id, { type: 'status', status: 'started', outcome: null });
      const session = this.#startSession({
        role: run.role,
        cwd,
        prompt: override ?? run.prompt ?? '',
        model: run.model,
        resume: run.sessionId,
        defaultBranch,
        pluginDir: this.#config.pluginDir,
        tools: createShinsaToolServer(run.role, handleTool),
        handleTool,
        onSession: (sessionId) => this.#linkSession(run, sessionId),
        onEntry: (entry) => this.#transcripts.record(run.id, entry),
        storeImage: (data, mediaType) => this.#storeImage(data, mediaType),
      });
      active.session = session;
      active.clock = new RunClock(this.#maxRunMs, () => {
        timedOut = true;
        this.#cancelSession(run.id, session);
      });
      active.clock.start();
      const result = await session.done;
      if (timedOut) return { outcome: 'failed', summary: 'It ran past its time limit without handing over.' };
      return result;
    } catch (error) {
      return { outcome: 'failed', summary: describeError(error) };
    } finally {
      active.clock?.stop();
    }
  }

  #linkSession(run: Run, sessionId: string) {
    if (sessionId === run.sessionId) return;
    this.#engine.dispatch({ type: 'run.link', runId: run.id, sessionId }).catch((error: unknown) => {
      log.warn('[Runs] Could not link session', { runId: run.id, error: describeError(error) });
    });
  }

  #cancelSession(runId: string, session: ClaudeSession) {
    session.cancel().catch((error: unknown) => {
      log.warn('[Runs] Could not stop a session', { runId, error: describeError(error) });
    });
  }

  async #discardEdits(path: string, role: string) {
    try {
      if (await stashEdits(path, `shinsa: edits by the ${role}`)) {
        log.warn('[Runs] A read-only agent changed files; set them aside', { role, path });
      }
    } catch (error) {
      log.warn('[Runs] Could not set aside edits by a read-only agent', {
        role,
        path,
        error: describeError(error),
      });
    }
  }

  async #end(runId: string, result: ClaudeSessionResult) {
    this.#transcripts.record(runId, { type: 'status', status: 'ended', outcome: result.outcome });
    await this.#engine.dispatch({ type: 'run.end', runId, outcome: result.outcome, summary: result.summary });
  }

  #listEarlier(taskId: string, except: string | undefined) {
    const earlier: ActiveRun[] = [];
    for (const [id, active] of this.#active) {
      if (id === except) break;
      if (active.taskId === taskId) earlier.push(active);
    }
    return earlier;
  }

  async quiesce(taskId: string, except?: string) {
    const earlier = this.#listEarlier(taskId, except);
    if (earlier.length === 0) return;
    const settled = Promise.all(earlier.map((active) => active.done)).then(() => 'settled' as const);
    const timeout = Bun.sleep(this.#quiesceMs).then(() => 'timeout' as const);
    if ((await Promise.race([settled, timeout])) === 'settled') return;
    await Promise.allSettled(earlier.map((active) => active.session?.cancel()));
  }

  async steer(runId: string, text: string) {
    if (this.#active.get(runId)?.session?.steer(text)) return;
    const run = this.#engine.state.runs[runId];
    if (!run) return;
    await this.#engine.dispatch({ type: 'message.deliver', taskId: run.taskId, text });
  }

  async cancel(runId: string) {
    await this.#active.get(runId)?.session?.cancel();
  }

  async resolveQuestion(gateId: string) {
    const gate = this.#engine.state.gates[gateId];
    if (!gate) return;
    const answer = gate.status === 'answered' ? (gate.response ?? '') : null;
    const waiter = this.#questions.get(gateId);
    if (waiter) {
      waiter(answer);
      return;
    }
    if (answer === null) return;
    const task = this.#engine.state.tasks[gate.taskId];
    if (!task || isTaskSettled(task)) return;
    const asker = gate.runId ? this.#engine.state.runs[gate.runId] : undefined;
    if (asker && asker.endedAt === null && !this.#active.has(asker.id)) {
      await this.execute(asker.id, resolveAnswerPrompt(gate.title, answer));
      return;
    }
    await this.#engine.dispatch({
      type: 'message.deliver',
      taskId: gate.taskId,
      text: resolveAnswerPrompt(gate.title, answer),
    });
  }

  async recover() {
    const waiting = new Set(
      listOpenGates(this.#engine.state)
        .filter((gate) => gate.purpose === 'agent_question')
        .map((gate) => gate.runId)
    );
    for (const run of listActiveRuns(this.#engine.state)) {
      if (run.status === 'queued' || waiting.has(run.id)) continue;
      this.execute(run.id, run.sessionId ? resolveContinuePrompt() : null).catch((error: unknown) => {
        log.error('[Runs] Resume failed', { runId: run.id, error: describeError(error) });
      });
    }
    await this.#engine.dispatch({ type: 'runs.dispatch' });
  }

  #current(runId: string) {
    const run = this.#engine.state.runs[runId];
    const task = run ? this.#engine.state.tasks[run.taskId] : undefined;
    if (!run || !task) throw new Error('This run no longer exists. End your turn.');
    if (run.endedAt !== null) throw new Error('This step is already over. End your turn.');
    return { run, task };
  }

  async #commit(runId: string) {
    const { run, task } = this.#current(runId);
    if (!task.worktreePath) return;
    await commitWorktree(task.worktreePath, resolveCommitMessage(task, run));
  }

  async #handleTool(runId: string, name: string, input: Record<string, unknown>, signal: AbortSignal) {
    switch (name) {
      case 'propose_plan': {
        const document = assertProtocol(validateSpecDocument(input));
        await this.#engine.dispatch({ type: 'agent.propose_plan', runId, document });
        return HANDED_OVER;
      }
      case 'complete_phase': {
        const handOver = assertProtocol(validatePhaseHandOver(input));
        await this.#commit(runId);
        await this.#engine.dispatch({ type: 'agent.complete_phase', runId, ...handOver });
        return HANDED_OVER;
      }
      case 'complete_fix': {
        const { summary } = assertProtocol(validateFixHandOver(input));
        await this.#commit(runId);
        await this.#engine.dispatch({ type: 'agent.complete_fix', runId, summary });
        return HANDED_OVER;
      }
      case 'report_review': {
        const findings = assertProtocol(validateFindings(input));
        await this.#engine.dispatch({ type: 'agent.report_review', runId, findings });
        return HANDED_OVER;
      }
      case 'ask':
        return this.#ask(runId, input, signal);
      case 'attach_evidence': {
        const { task } = this.#current(runId);
        const evidence = storeEvidence(input, task.worktreePath, this.#evidence);
        await this.#engine.dispatch({ type: 'agent.attach_evidence', runId, ...evidence });
        return 'Attached.';
      }
      case 'find_tasks':
        return serializeTaskReferences(this.#engine.state, readString(input, 'query') ?? '');
      case 'note': {
        const note = readString(input, 'note');
        if (!note) throw new Error('note is required.');
        await this.#engine.dispatch({ type: 'agent.note', runId, note });
        return 'Noted.';
      }
      default:
        throw new Error(`Unknown tool ${name}.`);
    }
  }

  #awaitAnswer(gateId: string, signal: AbortSignal) {
    return new Promise<string | null>((resolve) => {
      const settle = (answer: string | null) => {
        this.#questions.delete(gateId);
        signal.removeEventListener('abort', withdraw);
        resolve(answer);
      };
      const withdraw = () => settle(null);
      this.#questions.set(gateId, settle);
      signal.addEventListener('abort', withdraw, { once: true });
    });
  }

  async #ask(runId: string, input: Record<string, unknown>, signal: AbortSignal) {
    const question = readString(input, 'question');
    if (!question) throw new Error('question is required.');
    if (signal.aborted) throw new Error('This step was stopped. End your turn.');
    const gateId = Bun.randomUUIDv7();
    const answer = this.#awaitAnswer(gateId, signal);
    try {
      await this.#engine.dispatch({
        type: 'agent.ask',
        runId,
        gateId,
        question,
        context: readString(input, 'context'),
      });
    } catch (error) {
      this.#questions.get(gateId)?.(null);
      throw error;
    }
    const clock = this.#active.get(runId)?.clock;
    clock?.pause();
    this.#transcripts.record(runId, { type: 'status', status: 'waiting', outcome: null });
    const text = await answer;
    this.#transcripts.record(runId, { type: 'status', status: 'working', outcome: null });
    clock?.resume();
    if (text === null) return 'The question was withdrawn. Continue with your best judgement.';
    return `The human answered: ${text}`;
  }

  #storeImage(data: string, mediaType: string) {
    try {
      return this.#evidence.writeImage(data, mediaType);
    } catch (error) {
      log.warn('[Runs] Could not keep a tool image', { error: describeError(error) });
      return null;
    }
  }
}
