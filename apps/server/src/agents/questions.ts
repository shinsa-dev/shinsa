import {
  type Gate,
  isTaskSettled,
  resolveAnswerPrompt,
  resolveDelegationAnswerPrompt,
  resolveQuestionResumePrompt,
  resolveSupersededReply,
  resolveWithdrawnReply,
  type ShinsaCommand,
  validateQuestion,
  validateSecretRequest,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { ActiveRun } from './active.ts';
import { assertProtocol } from './handover.ts';
import { IdleRelease, type IdleReleaseOptions } from './idle.ts';
import type { AgentSession } from './providers/index.ts';
import type { Transcripts } from './transcripts/index.ts';

type QuestionReply =
  | { kind: 'answered'; text: string }
  | { kind: 'superseded'; text: string }
  | { kind: 'withdrawn' };

interface QuestionsOptions {
  engine: Engine;
  transcripts: Transcripts;
  active: ReadonlyMap<string, ActiveRun>;
  execute: (runId: string, prompt: string) => Promise<void>;
  idle?: IdleReleaseOptions;
}

type Waiter = (reply: QuestionReply) => void;

type QuestionDispatch = (command: ShinsaCommand) => Promise<unknown>;

const WITHDRAWN: QuestionReply = { kind: 'withdrawn' };

function resolveGateReply(gate: Gate): QuestionReply {
  if (gate.status === 'answered') return { kind: 'answered', text: gate.response ?? '' };
  if (gate.supersededBy) return { kind: 'superseded', text: gate.supersededBy };
  return WITHDRAWN;
}

function describeQuestionReply(reply: QuestionReply, delegated: boolean) {
  switch (reply.kind) {
    case 'answered':
      return delegated
        ? `The agent that delegated this task answered: ${reply.text}`
        : `The human answered: ${reply.text}`;
    case 'superseded':
      return resolveSupersededReply(reply.text);
    case 'withdrawn':
      return resolveWithdrawnReply();
  }
}

function describeSecretReply(reply: QuestionReply, gate: Gate | undefined, label: string) {
  switch (reply.kind) {
    case 'answered':
      if (gate?.decision === 'reject') return 'The human declined to give it. Continue without the secret.';
      return `The human saved the ${label}. Pass ${reply.text} where a secret is asked for, such as set_schedule’s webhook.signature.secret_ref. It works once and expires in a day; you never see the value.`;
    case 'superseded':
      return resolveSupersededReply(reply.text);
    case 'withdrawn':
      return 'The request was withdrawn. Continue without the secret, or ask again later.';
  }
}

export class Questions {
  readonly #options: QuestionsOptions;
  readonly #waiters = new Map<string, Waiter>();
  readonly #idle: IdleRelease;

  constructor(options: QuestionsOptions) {
    this.#options = options;
    this.#idle = new IdleRelease((runId, session) => this.#release(runId, session), options.idle);
  }

  touch(runId: string) {
    this.#idle.touch(runId);
  }

  forget(runId: string) {
    this.#idle.forget(runId);
  }

  async releaseWaiting(runId: string) {
    const session = this.#options.active.get(runId)?.session;
    if (!session || !this.#idle.isWaiting(runId, session)) return;
    this.#idle.forget(runId);
    await this.#release(runId, session);
  }

  async ask(
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) {
    const asked = assertProtocol(validateQuestion(input));
    const gateId = Bun.randomUUIDv7();
    const reply = await this.#open(runId, gateId, signal, dispatch, {
      type: 'agent.ask',
      runId,
      attemptId,
      gateId,
      ...asked,
    });
    return describeQuestionReply(reply, Boolean(this.#options.engine.state.runs[runId]?.delegation));
  }

  async requestSecret(
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) {
    const { label, reason } = assertProtocol(validateSecretRequest(input));
    const gateId = Bun.randomUUIDv7();
    const reply = await this.#open(runId, gateId, signal, dispatch, {
      type: 'agent.request_secret',
      runId,
      attemptId,
      gateId,
      label,
      reason,
    });
    return describeSecretReply(reply, this.#options.engine.state.gates[gateId], label);
  }

  async resolve(gateId: string) {
    const { engine, active } = this.#options;
    const gate = engine.state.gates[gateId];
    if (!gate) return;
    const reply = resolveGateReply(gate);
    if (this.#settle(gateId, reply) || reply.kind === 'withdrawn') return;
    const releasing = gate.runId ? active.get(gate.runId) : undefined;
    if (releasing?.released) await releasing.done;
    const task = engine.state.tasks[gate.taskId];
    if (!task || isTaskSettled(task)) return;
    const asker = gate.runId ? engine.state.runs[gate.runId] : undefined;
    if (asker && asker.endedAt === null && !active.has(asker.id)) {
      await this.#options.execute(asker.id, resolveQuestionResumePrompt(gate.title, reply));
      return;
    }
    const text = reply.kind === 'answered' ? resolveAnswerPrompt(gate.title, reply.text) : reply.text;
    await engine.dispatch(
      { type: 'message.deliver', taskId: gate.taskId, text },
      { id: `question:${gateId}:message.deliver` }
    );
  }

  async replyToDelegate(runId: string, questionId: string) {
    const run = this.#options.engine.state.runs[runId];
    const question = run?.delegation?.question;
    if (!run || question?.id !== questionId || question.answer === null) return;
    if (this.#settle(questionId, { kind: 'answered', text: question.answer })) return;
    if (run.endedAt !== null) return;
    await this.#options.execute(runId, resolveDelegationAnswerPrompt(question.question, question.answer));
  }

  #settle(id: string, reply: QuestionReply) {
    const waiter = this.#waiters.get(id);
    if (!waiter) return false;
    waiter(reply);
    return true;
  }

  #await(id: string, signal: AbortSignal) {
    return new Promise<QuestionReply>((resolve) => {
      const settle = (reply: QuestionReply) => {
        this.#waiters.delete(id);
        signal.removeEventListener('abort', withdraw);
        resolve(reply);
      };
      const withdraw = () => settle(WITHDRAWN);
      this.#waiters.set(id, settle);
      signal.addEventListener('abort', withdraw, { once: true });
    });
  }

  async #open(
    runId: string,
    gateId: string,
    signal: AbortSignal,
    dispatch: QuestionDispatch,
    command: ShinsaCommand
  ) {
    if (signal.aborted) throw new Error('This step was stopped. End your turn.');
    const reply = this.#await(gateId, signal);
    try {
      await dispatch(command);
    } catch (error) {
      this.#settle(gateId, WITHDRAWN);
      throw error;
    }
    return this.#waitForReply(runId, reply);
  }

  async #waitForReply(runId: string, reply: Promise<QuestionReply>) {
    const { transcripts } = this.#options;
    const active = this.#options.active.get(runId);
    active?.clock?.pause();
    const endWait = active?.session && !active.delegated ? this.#idle.wait(runId, active.session) : null;
    transcripts.record(runId, { type: 'status', status: 'waiting', outcome: null });
    const result = await reply;
    endWait?.();
    if (!active?.released) transcripts.record(runId, { type: 'status', status: 'working', outcome: null });
    active?.clock?.resume();
    return result;
  }

  async #release(runId: string, session: AgentSession) {
    const active = this.#options.active.get(runId);
    if (!active || active.session !== session || active.stopping) return;
    active.released = true;
    active.stopping = true;
    const waiters = this.#takeWaiters(runId);
    log.info('[Runs] Released an idle session; the answer resumes it', { runId });
    try {
      await session.cancel();
    } catch (error) {
      log.warn('[Runs] Could not stop an idle session', { runId, error: describeError(error) });
    }
    for (const waiter of waiters) waiter(WITHDRAWN);
  }

  #takeWaiters(runId: string) {
    const waiters: Waiter[] = [];
    for (const gate of Object.values(this.#options.engine.state.gates)) {
      const waiter = gate.runId === runId ? this.#waiters.get(gate.id) : undefined;
      if (!waiter) continue;
      this.#waiters.delete(gate.id);
      waiters.push(waiter);
    }
    return waiters;
  }
}
