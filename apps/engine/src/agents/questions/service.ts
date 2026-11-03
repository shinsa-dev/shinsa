import {
  type Gate,
  isTaskSettled,
  resolveAnsweredReply,
  resolveAnswerPrompt,
  resolveDelegationAnswerPrompt,
  resolveQuestionResumePrompt,
  resolveSupersededReply,
  resolveWithdrawnReply,
  type ShinsaCommand,
  validateQuestion,
  validateSecretRequest,
} from '@shinsa/core';
import { Deferred, Effect } from 'effect';
import { describeError } from '../../log/index.ts';
import { awaitAbort } from '../../shell/abort.ts';
import { assertProtocol } from '../handover.ts';
import { makeIdleRelease } from '../idle/service.ts';
import type { AgentSession } from '../providers/index.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import {
  type QuestionDispatch,
  type QuestionReply,
  type QuestionsDefinition,
  type QuestionsHandle,
  WITHDRAWN,
} from './schema.ts';
import { makeReplyWaiters } from './waiters/service.ts';

export const makeQuestions = Effect.fn('Questions.make')(function* (definition: QuestionsDefinition) {
  const { active: live } = definition;
  const waiters = yield* makeReplyWaiters();

  const resolveGateReply = (gate: Gate): QuestionReply => {
    if (gate.status === 'answered') return { kind: 'answered', text: gate.response ?? '' };
    if (gate.supersededBy) return { kind: 'superseded', text: gate.supersededBy };
    return WITHDRAWN;
  };

  const describeQuestionReply = (reply: QuestionReply, delegated: boolean) => {
    switch (reply.kind) {
      case 'answered':
        return resolveAnsweredReply(reply.text, delegated);
      case 'superseded':
        return resolveSupersededReply(reply.text);
      case 'withdrawn':
        return resolveWithdrawnReply();
    }
  };

  const describeSecretReply = (reply: QuestionReply, gate: Gate | undefined, label: string) => {
    switch (reply.kind) {
      case 'answered':
        if (gate?.decision === 'reject') return 'The human declined to give it. Continue without the secret.';
        return `The human saved the ${label}. Pass ${reply.text} where a secret is asked for, such as set_schedule’s webhook.signature.secret_ref. It works once and expires in a day; you never see the value.`;
      case 'superseded':
        return resolveSupersededReply(reply.text);
      case 'withdrawn':
        return 'The request was withdrawn. Continue without the secret, or ask again later.';
    }
  };

  const readHandOver = <T>(result: { ok: true; value: T } | { ok: false; errors: string[] }) =>
    Effect.try({
      try: () => assertProtocol(result),
      catch: (error) => new ToolCallFailed({ message: describeError(error) }),
    });

  const release = Effect.fn('Questions.release')(function* (runId: string, session: AgentSession) {
    const active = live.get(runId);
    if (!active || active.session !== session || active.stopping) return;
    active.released = true;
    active.stopping = true;
    const gates = Object.values((yield* definition.state).gates).filter((gate) => gate.runId === runId);
    const withdrawn = yield* waiters.take(gates.map((gate) => gate.id));
    yield* Effect.logInfo('[Runs] Released an idle session; the answer resumes it').pipe(
      Effect.annotateLogs({ runId })
    );
    yield* Effect.tryPromise(() => session.cancel()).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Runs] Could not stop an idle session').pipe(
          Effect.annotateLogs({ runId, error: describeError(failure.cause) })
        )
      )
    );
    yield* Effect.forEach(withdrawn, (waiter) => Deferred.succeed(waiter, WITHDRAWN), { discard: true });
  });

  const idle = yield* makeIdleRelease({ ...definition.idle, release });

  const releaseWaiting = Effect.fn('Questions.releaseWaiting')(function* (runId: string) {
    const session = live.get(runId)?.session;
    if (!session || !(yield* idle.isWaiting(runId, session))) return;
    yield* idle.forget(runId);
    yield* release(runId, session);
  });

  const waitForReply = Effect.fn('Questions.waitForReply')(function* (
    runId: string,
    gateId: string,
    waiter: Deferred.Deferred<QuestionReply>,
    signal: AbortSignal
  ) {
    const active = live.get(runId);
    active?.clock?.pause();
    const endWait = active?.session && !active.delegated ? yield* idle.wait(runId, active.session) : null;
    yield* definition.record(runId, { type: 'status', status: 'waiting', outcome: null });
    const withdrawOnAbort = awaitAbort(signal).pipe(
      Effect.andThen(waiters.settle(gateId, WITHDRAWN)),
      Effect.andThen(Deferred.await(waiter))
    );
    const result = yield* Effect.raceFirst(Deferred.await(waiter), withdrawOnAbort);
    if (endWait) yield* endWait;
    if (!active?.released)
      yield* definition.record(runId, { type: 'status', status: 'working', outcome: null });
    active?.clock?.resume();
    return result;
  });

  const open = Effect.fn('Questions.open')(function* (
    runId: string,
    gateId: string,
    signal: AbortSignal,
    dispatch: QuestionDispatch,
    command: ShinsaCommand
  ) {
    if (signal.aborted)
      return yield* new ToolCallFailed({ message: 'This step was stopped. End your turn.' });
    const waiter = yield* waiters.open(gateId);
    yield* dispatch(command).pipe(Effect.tapError(() => waiters.settle(gateId, WITHDRAWN)));
    return yield* waitForReply(runId, gateId, waiter, signal);
  });

  const ask = Effect.fn('Questions.ask')(function* (
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) {
    const asked = yield* readHandOver(validateQuestion(input));
    const gateId = yield* definition.newId;
    const reply = yield* open(runId, gateId, signal, dispatch, {
      type: 'agent.ask',
      runId,
      attemptId,
      gateId,
      ...asked,
    });
    return describeQuestionReply(reply, Boolean((yield* definition.state).runs[runId]?.delegation));
  });

  const requestSecret = Effect.fn('Questions.requestSecret')(function* (
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) {
    const { label, reason } = yield* readHandOver(validateSecretRequest(input));
    const gateId = yield* definition.newId;
    const reply = yield* open(runId, gateId, signal, dispatch, {
      type: 'agent.request_secret',
      runId,
      attemptId,
      gateId,
      label,
      reason,
    });
    return describeSecretReply(reply, (yield* definition.state).gates[gateId], label);
  });

  const resolve = Effect.fn('Questions.resolve')(function* (gateId: string) {
    const gate = (yield* definition.state).gates[gateId];
    if (!gate) return;
    const reply = resolveGateReply(gate);
    if ((yield* waiters.settle(gateId, reply)) || reply.kind === 'withdrawn') return;
    const releasing = gate.runId ? live.get(gate.runId) : undefined;
    if (releasing?.released) yield* Effect.promise(() => releasing.done);
    const state = yield* definition.state;
    const task = state.tasks[gate.taskId];
    if (!task || isTaskSettled(task)) return;
    const asker = gate.runId ? state.runs[gate.runId] : undefined;
    if (asker && asker.endedAt === null && !live.has(asker.id))
      return yield* definition.execute(asker.id, resolveQuestionResumePrompt(gate.title, reply));
    const text = reply.kind === 'answered' ? resolveAnswerPrompt(gate.title, reply.text) : reply.text;
    yield* definition.dispatch(
      { type: 'message.deliver', taskId: gate.taskId, text },
      `question:${gateId}:message.deliver`
    );
  });

  const replyToDelegate = Effect.fn('Questions.replyToDelegate')(function* (
    runId: string,
    questionId: string
  ) {
    const run = (yield* definition.state).runs[runId];
    const question = run?.delegation?.question;
    if (!run || question?.id !== questionId || question.answer === null) return;
    if (yield* waiters.settle(questionId, { kind: 'answered', text: question.answer })) return;
    if (run.endedAt !== null) return;
    yield* definition.execute(runId, resolveDelegationAnswerPrompt(question.question, question.answer));
  });

  const handle: QuestionsHandle = {
    touch: idle.touch,
    forget: idle.forget,
    releaseWaiting,
    ask,
    requestSecret,
    resolve,
    replyToDelegate,
  };
  return handle;
});
