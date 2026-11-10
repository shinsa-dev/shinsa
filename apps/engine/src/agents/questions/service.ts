import {
  type DomainError,
  type Gate,
  isTaskSettled,
  resolveAnsweredReply,
  resolveBrowserSignInReply,
  resolveBrowserSignInResumePrompt,
  resolveAnswerPrompt,
  resolveDelegationAnswerPrompt,
  resolveQuestionResumePrompt,
  resolveSupersededReply,
  resolveWithdrawnReply,
  type ShinsaCommand,
  type Validation,
  validateBrowserSignInRequest,
  validateQuestion,
  validateSecretRequest,
} from '@shinsa/core';
import { Clock, Context, Deferred, Effect, Layer } from 'effect';
import { describeError } from '../../log/index.ts';
import type { EngineStopped } from '../../runtime/engine/schema.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { awaitAbort } from '../../shell/abort.ts';
import { LiveRuns } from '../active/service.ts';
import { resolveHandOver } from '../handover.ts';
import { IdleReleaseSettings } from '../idle/schema.ts';
import { makeIdleRelease } from '../idle/service.ts';
import type { AgentSession } from '../providers/index.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import { Transcripts } from '../transcripts/service.ts';
import { type QuestionDispatch, type QuestionReply, WITHDRAWN } from './schema.ts';
import { makeReplyWaiters } from './waiters/service.ts';

export class Questions extends Context.Service<
  Questions,
  {
    readonly touch: (runId: string) => Effect.Effect<void>;
    readonly forget: (runId: string) => Effect.Effect<void>;
    readonly releaseWaiting: (runId: string) => Effect.Effect<void>;
    readonly ask: (
      runId: string,
      attemptId: string,
      input: Record<string, unknown>,
      signal: AbortSignal,
      dispatch: QuestionDispatch
    ) => Effect.Effect<string, ToolCallFailed | DomainError>;
    readonly requestSecret: (
      runId: string,
      attemptId: string,
      input: Record<string, unknown>,
      signal: AbortSignal,
      dispatch: QuestionDispatch
    ) => Effect.Effect<string, ToolCallFailed | DomainError>;
    readonly requestBrowserSignIn: (
      runId: string,
      attemptId: string,
      input: Record<string, unknown>,
      signal: AbortSignal,
      dispatch: QuestionDispatch
    ) => Effect.Effect<string, ToolCallFailed | DomainError>;
    readonly resolve: (gateId: string) => Effect.Effect<void, DomainError | EngineStopped>;
    readonly replyToDelegate: (runId: string, questionId: string) => Effect.Effect<void>;
  }
>()('shinsa/engine/agents/questions/Questions') {
  static readonly layer = Layer.effect(
    Questions,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const runs = yield* LiveRuns;
      const transcripts = yield* Transcripts;
      const settings = yield* IdleReleaseSettings;
      const live = runs.active;
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
            if (gate?.decision === 'reject')
              return 'The human declined to give it. Continue without the secret.';
            return `The human saved the ${label}. Pass ${reply.text} where a secret is asked for, such as set_schedule’s webhook.signature.secret_ref. It works once and expires in a day; you never see the value.`;
          case 'superseded':
            return resolveSupersededReply(reply.text);
          case 'withdrawn':
            return 'The request was withdrawn. Continue without the secret, or ask again later.';
        }
      };

      const readHandOver = <T>(validation: Validation<T>) =>
        Effect.fromResult(resolveHandOver(validation)).pipe(
          Effect.mapError((error) => new ToolCallFailed({ message: describeError(error) }))
        );

      const release = Effect.fn('Questions.release')(function* (runId: string, session: AgentSession) {
        const active = live.get(runId);
        if (!active || active.session !== session || active.stopping) return;
        active.released = true;
        active.stopping = true;
        const gates = Object.values((yield* engine.state).gates).filter((gate) => gate.runId === runId);
        const withdrawn = yield* waiters.take(gates.map((gate) => gate.id));
        yield* Effect.logInfo('[Runs] Released an idle session; the answer resumes it').pipe(
          Effect.annotateLogs({ runId })
        );
        yield* session.cancel.pipe(
          Effect.catchDefect((error) =>
            Effect.logWarning('[Runs] Could not stop an idle session').pipe(
              Effect.annotateLogs({ runId, error: describeError(error) })
            )
          )
        );
        yield* Effect.forEach(withdrawn, (waiter) => Deferred.succeed(waiter, WITHDRAWN), { discard: true });
      });

      const idle = yield* makeIdleRelease({ ...settings, now: Clock.currentTimeMillis, release });

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
        if (active?.clock) yield* active.clock.pause;
        const endWait = active?.session && !active.delegated ? yield* idle.wait(runId, active.session) : null;
        yield* transcripts.record(runId, { type: 'status', status: 'waiting', outcome: null });
        const withdrawOnAbort = awaitAbort(signal).pipe(
          Effect.andThen(waiters.settle(gateId, WITHDRAWN)),
          Effect.andThen(Deferred.await(waiter))
        );
        const result = yield* Effect.raceFirst(Deferred.await(waiter), withdrawOnAbort);
        if (endWait) yield* endWait;
        if (!active?.released)
          yield* transcripts.record(runId, { type: 'status', status: 'working', outcome: null });
        if (active?.clock) yield* active.clock.resume;
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
        const gateId = Bun.randomUUIDv7();
        const reply = yield* open(runId, gateId, signal, dispatch, {
          type: 'agent.ask',
          runId,
          attemptId,
          gateId,
          ...asked,
        });
        return describeQuestionReply(reply, Boolean((yield* engine.state).runs[runId]?.delegation));
      });

      const requestSecret = Effect.fn('Questions.requestSecret')(function* (
        runId: string,
        attemptId: string,
        input: Record<string, unknown>,
        signal: AbortSignal,
        dispatch: QuestionDispatch
      ) {
        const { label, reason } = yield* readHandOver(validateSecretRequest(input));
        const gateId = Bun.randomUUIDv7();
        const reply = yield* open(runId, gateId, signal, dispatch, {
          type: 'agent.request_secret',
          runId,
          attemptId,
          gateId,
          label,
          reason,
        });
        return describeSecretReply(reply, (yield* engine.state).gates[gateId], label);
      });

      const requestBrowserSignIn = Effect.fn('Questions.requestBrowserSignIn')(function* (
        runId: string,
        attemptId: string,
        input: Record<string, unknown>,
        signal: AbortSignal,
        dispatch: QuestionDispatch
      ) {
        const { url, reason } = yield* readHandOver(validateBrowserSignInRequest(input));
        const gateId = Bun.randomUUIDv7();
        yield* open(runId, gateId, signal, dispatch, {
          type: 'agent.request_browser_sign_in',
          runId,
          attemptId,
          gateId,
          url,
          reason,
        });
        return resolveBrowserSignInReply((yield* engine.state).gates[gateId]);
      });

      const resolve = Effect.fn('Questions.resolve')(function* (gateId: string) {
        const gate = (yield* engine.state).gates[gateId];
        if (!gate) return;
        const reply = resolveGateReply(gate);
        if ((yield* waiters.settle(gateId, reply)) || reply.kind === 'withdrawn') return;
        const releasing = gate.runId ? live.get(gate.runId) : undefined;
        if (releasing?.released) yield* Effect.promise(() => releasing.done);
        const state = yield* engine.state;
        const task = state.tasks[gate.taskId];
        if (!task || isTaskSettled(task)) return;
        const asker = gate.runId ? state.runs[gate.runId] : undefined;
        const browserSignIn = gate.type === 'browser_sign_in' ? resolveBrowserSignInResumePrompt(gate) : null;
        if (asker && asker.endedAt === null && !live.has(asker.id))
          return yield* runs.execute(
            asker.id,
            browserSignIn ?? resolveQuestionResumePrompt(gate.title, reply),
            null
          );
        const text =
          browserSignIn ??
          (reply.kind === 'answered' ? resolveAnswerPrompt(gate.title, reply.text) : reply.text);
        yield* engine.dispatch(
          { type: 'message.deliver', taskId: gate.taskId, text },
          { id: `question:${gateId}:message.deliver` }
        );
      });

      const replyToDelegate = Effect.fn('Questions.replyToDelegate')(function* (
        runId: string,
        questionId: string
      ) {
        const run = (yield* engine.state).runs[runId];
        const question = run?.delegation?.question;
        if (!run || question?.id !== questionId || question.answer === null) return;
        if (yield* waiters.settle(questionId, { kind: 'answered', text: question.answer })) return;
        if (run.endedAt !== null) return;
        yield* runs.execute(runId, resolveDelegationAnswerPrompt(question.question, question.answer), null);
      });

      return Questions.of({
        touch: idle.touch,
        forget: idle.forget,
        releaseWaiting,
        ask,
        requestSecret,
        requestBrowserSignIn,
        resolve,
        replyToDelegate,
      });
    })
  );
}
