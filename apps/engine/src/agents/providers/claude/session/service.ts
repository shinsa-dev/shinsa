import type {
  McpServerConfig,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { type RunFailure, resolveSteerPrompt } from '@shinsa/core';
import {
  type Cause,
  Clock,
  Deferred,
  Duration,
  Effect,
  FiberHandle,
  Option,
  Queue,
  Ref,
  Result,
  Stream,
} from 'effect';
import { resolveAccountEnv } from '../../../../accounts/paths.ts';
import type { DeferredServer } from '../../../../extensions/loader.ts';
import { describeError } from '../../../../log/redact.ts';
import { SHINSA_INSTRUCTIONS } from '../../instructions.ts';
import type { AgentSessionInput, AgentSessionResult } from '../../types.ts';
import {
  appendStderr,
  cleanProcessError,
  createSetupFailure,
  createStuckFailure,
  createTurnEvidence,
  recordAssistantError,
  recordRateLimit,
  resolveClaudeVerdict,
  resolveEndedFailure,
  type TurnVerdict,
} from '../classify.ts';
import { listBackgroundWork, resolveCacheExpiry } from '../context.ts';
import { resolveClaudeExtensions, serializeClaudeServer } from '../extensions.ts';
import { createClaudeProcess } from '../process.ts';
import { resolveUsageSnapshot } from '../recorder.ts';
import { createClaudeRecorder } from '../recorder.ts';
import { resolveClaudeRoute } from '../route.ts';
import { CLAUDE_RUNTIME, resolveClaudeProcess } from '../sdk.ts';
import { resolveClaudeUsage } from '../usage.ts';
import { createDetachedClock } from './clock.ts';
import {
  removeServers,
  resolveFastModeNotice,
  resolveQueryOptions,
  resolveSummary,
  serializeToolServer,
} from './options.ts';
import {
  createUserMessage,
  isOtherOrigin,
  listEchoedPromptIds,
  listUndeliveredSteers,
  takeAnsweredPrompts,
} from './prompts.ts';
import {
  CONTEXT_TIMEOUT,
  ClaudeCallFailed,
  type ClaudeSessionHandle,
  type ClaudeSessionOptions,
  ClaudeSessionEnded,
  type ClaudeSessionState,
  ClaudeStartFailed,
  ClaudeStreamBroke,
  type ContextMeasure,
  EXIT_GRACE,
  FOLDED_TURN,
  INTERRUPT_TIMEOUT,
  McpServersRefused,
  SESSION_ENDED,
  STREAM_ENDED,
} from './schema.ts';

export const makeClaudeSession = Effect.fn('ClaudeSession.make')(function* (
  input: AgentSessionInput,
  options: ClaudeSessionOptions
) {
  const scope = yield* Effect.scope;
  const services = yield* Effect.context<never>();
  const clock = yield* Clock.Clock;
  const detached = createDetachedClock(clock);
  const detach = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, Clock.Clock, detached);
  const runtime = options.runtime ?? CLAUDE_RUNTIME;
  const now = options.now ?? (() => clock.currentTimeMillisUnsafe());
  const within = (ms: number | undefined, fallback: Duration.Duration) =>
    ms === undefined ? fallback : Duration.millis(ms);
  const foldedTurn = within(options.foldedTurnMs, FOLDED_TURN);
  const contextTimeout = within(options.contextTimeoutMs, CONTEXT_TIMEOUT);
  const exitGrace = within(options.exitGraceMs, EXIT_GRACE);
  const interruptTimeout = within(options.interruptTimeoutMs, INTERRUPT_TIMEOUT);
  const callFailed = (error: unknown) => new ClaudeCallFailed({ message: describeError(error) });
  const startFailed = (error: unknown) => new ClaudeStartFailed({ message: describeError(error) });
  const recorder = createClaudeRecorder(input.onEntry, input.storeImage);
  const child = (options.createProcess ?? createClaudeProcess)(input.onProcess);
  const extensions = resolveClaudeExtensions(input.extensions);
  const hasServers = Object.keys(extensions.servers).length > 0;
  const appended = [SHINSA_INSTRUCTIONS, extensions.instructions].filter(Boolean).join('\n\n');

  const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
  const released = yield* Deferred.make<void>();
  const result = yield* Deferred.make<AgentSessionResult>();
  const folded = yield* FiberHandle.make<void>();
  const exiting = yield* FiberHandle.make<void>();
  const query = yield* Ref.make<Query | null>(null);
  const links = yield* Ref.make<{ unwatch: (() => void) | null; releaseFold: (() => void) | null }>({
    unwatch: null,
    releaseFold: null,
  });
  const state = yield* Ref.make<ClaudeSessionState>({
    ledger: { pending: [], echoes: false },
    cancelled: false,
    closed: false,
    terminated: false,
    started: false,
    eunoe: false,
    stuck: null,
    evidence: createTurnEvidence(),
    verdict: null,
    summary: null,
    usage: null,
    contextTokens: null,
    contextWindow: null,
    cacheExpiresAt: null,
    background: new Set(),
    connected: { [input.tools.name]: serializeToolServer(input.tools), ...extensions.servers },
  });

  const terminate = Effect.gen(function* () {
    const first = yield* Ref.modify(state, (current) => [
      !current.terminated,
      { ...current, terminated: true },
    ]);
    if (!first) return;
    yield* Effect.tryPromise({
      try: () => child.terminate(),
      catch: callFailed,
    }).pipe(Effect.ignore);
    (yield* Ref.get(query))?.close();
  });

  const awaitExit = FiberHandle.run(
    exiting,
    detach(Effect.sleep(exitGrace)).pipe(
      Effect.andThen(
        Effect.uninterruptible(
          Effect.logWarning(
            '[Claude] The agent’s process did not exit after its turn, so Shinsa stopped it'
          ).pipe(Effect.annotateLogs({ cwd: input.cwd }), Effect.andThen(terminate))
        )
      )
    ),
    { onlyIfMissing: true }
  );

  const close = Effect.gen(function* () {
    yield* Ref.update(state, (current) => ({ ...current, closed: true }));
    yield* Queue.end(prompts);
    yield* awaitExit;
    yield* FiberHandle.clear(folded);
  });

  const closeFolded = Effect.andThen(
    Ref.update(state, (current) => ({ ...current, ledger: { ...current.ledger, pending: [] } })),
    close
  );

  const send = Effect.fn('ClaudeSession.send')(function* (text: string, wire: string, steer: boolean) {
    const id = crypto.randomUUID();
    yield* Ref.update(state, (current) => ({
      ...current,
      ledger: { ...current.ledger, pending: [...current.ledger.pending, { id, text, steer }] },
    }));
    yield* Queue.offer(prompts, createUserMessage(wire, id));
  });

  const interrupt = Effect.gen(function* () {
    yield* close;
    const active = yield* Ref.get(query);
    if (!active) return;
    const stopped = yield* Effect.tryPromise({
      try: () => active.interrupt(),
      catch: callFailed,
    }).pipe(
      detach,
      Effect.timeoutOption(interruptTimeout),
      Effect.map(Option.isSome),
      Effect.catchTag('ClaudeCallFailed', () => Effect.succeed(false))
    );
    if (!stopped) yield* terminate;
  });

  const stopStuck = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (current.stuck || current.cancelled) return;
    const stuck = createStuckFailure();
    yield* Ref.update(state, (latest) => ({ ...latest, stuck }));
    input.onEntry({ type: 'error', text: stuck.message });
    yield* Effect.forkIn(detach(interrupt), scope);
  });

  const recordInit = Effect.fn('ClaudeSession.recordInit')(function* (message: SDKSystemMessage) {
    input.onSession(message.session_id);
    const fast = input.fastMode ? resolveFastModeNotice(message) : null;
    if (fast) recorder.notify(fast);
    const eunoe = options.eunoe;
    if (!(yield* Ref.get(state)).eunoe || !eunoe) return;
    const current = yield* Ref.get(links);
    current.unwatch?.();
    const unwatch = eunoe.watch(message.session_id, {
      notice: recorder.notify,
      stuck: () => {
        Effect.runForkWith(services)(stopStuck);
      },
    });
    yield* Ref.update(links, (latest) => ({ ...latest, unwatch }));
  });

  const observe = Effect.fn('ClaudeSession.observe')(function* (message: SDKMessage) {
    input.onActivity?.();
    if (message.type === 'system' && message.subtype === 'init') yield* recordInit(message);
    if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
      const background = listBackgroundWork(message.tasks);
      yield* Ref.update(state, (current) => ({ ...current, background }));
    }
    const { evidence } = yield* Ref.get(state);
    if (message.type === 'assistant') recordAssistantError(evidence, message);
    if (message.type === 'rate_limit_event') recordRateLimit(evidence, message.rate_limit_info);
    recorder.record(message);
    yield* FiberHandle.clear(folded);
  });

  const measureContext = Effect.fn('ClaudeSession.measureContext')(function* (
    active: Query,
    message: SDKResultMessage
  ) {
    const fallback = recorder.takeUsage();
    let measured: ContextMeasure | null = null;
    if (typeof active.getContextUsage === 'function') {
      const read = yield* Effect.tryPromise({
        try: () => active.getContextUsage(),
        catch: callFailed,
      }).pipe(
        detach,
        Effect.timeoutOption(contextTimeout),
        Effect.catchTag('ClaudeCallFailed', (failure) =>
          Effect.logWarning('[Claude] Could not read the context usage').pipe(
            Effect.annotateLogs({ error: failure.message }),
            Effect.as(Option.none())
          )
        )
      );
      measured = Option.match(read, {
        onNone: () => null,
        onSome: (usage) =>
          usage && usage.totalTokens > 0
            ? { usedTokens: usage.totalTokens, maxTokens: usage.maxTokens > 0 ? usage.maxTokens : null }
            : null,
      });
    }
    const usage = measured ?? fallback;
    if (!usage) return null;
    const total = resolveUsageSnapshot(message.usage, null)?.usedTokens ?? null;
    const maxTokens = usage.maxTokens ?? recorder.window();
    recorder.notify({
      kind: 'context',
      usedTokens: usage.usedTokens,
      maxTokens,
      totalProcessedTokens: total !== null && total > usage.usedTokens ? total : null,
    });
    const context: ContextMeasure = { usedTokens: usage.usedTokens, maxTokens };
    return context;
  });

  const recordAccount = Effect.fn('ClaudeSession.recordAccount')(function* (active: Query) {
    if (typeof active.accountInfo !== 'function') return;
    yield* Effect.tryPromise({
      try: () => active.accountInfo(),
      catch: callFailed,
    }).pipe(
      Effect.map((account) =>
        recorder.notify({
          kind: 'account',
          email: account.email ?? null,
          organization: account.organization ?? null,
          plan: account.subscriptionType ?? null,
        })
      ),
      Effect.catchTag('ClaudeCallFailed', (failure) =>
        Effect.logWarning('[Claude] Could not read the account').pipe(
          Effect.annotateLogs({ error: failure.message })
        )
      )
    );
  });

  const answer = Effect.fn('ClaudeSession.answer')(function* (message: SDKResultMessage, next: TurnVerdict) {
    const ids = listEchoedPromptIds(message);
    const { ledger } = yield* Ref.get(state);
    if (ids.length === 0 && ledger.echoes && isOtherOrigin(message)) return [];
    return yield* Ref.modify(state, (current) => {
      const [answered, taken] = takeAnsweredPrompts(current.ledger, ids, next.status !== 'completed');
      return [answered, { ...current, ledger: taken }];
    });
  });

  const settle = Effect.fn('ClaudeSession.settle')(function* (active: Query, message: SDKResultMessage) {
    const before = yield* Ref.get(state);
    const usage = resolveClaudeUsage(message) ?? before.usage;
    const next = resolveClaudeVerdict(message, before.evidence, now());
    yield* Ref.update(state, (current) => ({ ...current, usage }));
    const answered = yield* answer(message, next);
    if (answered.length === 0) return;
    const after = yield* Ref.updateAndGet(state, (current) => ({
      ...current,
      evidence: createTurnEvidence(),
    }));
    const steered = answered.length === 1 && after.ledger.pending.some((prompt) => prompt.steer);
    if (next.status === 'interrupted' && !after.cancelled && steered) return;
    const cacheExpiresAt = resolveCacheExpiry(message.usage, now());
    const measured = yield* measureContext(active, message);
    if (next.status === 'interrupted') recorder.notify({ kind: 'interrupted' });
    const settled = yield* Ref.updateAndGet(state, (current) => ({
      ...current,
      cacheExpiresAt,
      contextTokens: measured?.usedTokens ?? current.contextTokens,
      contextWindow: measured?.maxTokens ?? current.contextWindow,
      verdict: next,
      summary: resolveSummary(message, next),
    }));
    if (settled.ledger.pending.length === 0) yield* close;
    else if (!settled.ledger.echoes) {
      yield* FiberHandle.run(
        folded,
        detach(Effect.sleep(foldedTurn)).pipe(
          Effect.andThen(Effect.forkIn(closeFolded, scope)),
          Effect.asVoid
        )
      );
    }
  });

  const resolveStopped = (
    current: ClaudeSessionState,
    text: string | null,
    undelivered: string[]
  ): AgentSessionResult | null => {
    if (current.cancelled) return { outcome: 'cancelled', summary: text, undelivered };
    if (current.stuck) {
      const stuck: RunFailure = current.stuck;
      return { outcome: 'failed', summary: stuck.message, failure: stuck, undelivered };
    }
    return null;
  };

  const endEarly = (current: ClaudeSessionState, text: string, undelivered: string[]): AgentSessionResult => {
    const failure = resolveEndedFailure(text, current.evidence);
    input.onEntry({ type: 'error', text });
    return { outcome: 'failed', summary: failure.message, failure, undelivered };
  };

  const finish = Effect.gen(function* () {
    recorder.flush('interim');
    const current = yield* Ref.get(state);
    const undelivered = listUndeliveredSteers(current.ledger);
    const stopped = resolveStopped(current, current.summary, undelivered);
    if (stopped) return stopped;
    if (!current.verdict) return endEarly(current, STREAM_ENDED, undelivered);
    const ended: AgentSessionResult = {
      outcome: current.verdict.status === 'completed' ? 'completed' : 'failed',
      summary: current.summary,
      failure: current.verdict.failure,
      undelivered,
    };
    return ended;
  });

  const crash = Effect.fn('ClaudeSession.crash')(function* (message: string) {
    const before = yield* Ref.get(state);
    const answeredAll = before.ledger.pending.length === 0;
    const settled = answeredAll ? before.verdict?.failure : null;
    const finished = answeredAll && before.verdict !== null;
    yield* close;
    const current = yield* Ref.get(state);
    if (current.terminated && finished && !current.cancelled) return yield* finish;
    recorder.flush('interim');
    const undelivered = listUndeliveredSteers(current.ledger);
    const stopped = resolveStopped(current, null, undelivered);
    if (stopped) return stopped;
    if (settled) {
      const failed: AgentSessionResult = {
        outcome: 'failed',
        summary: current.summary,
        failure: settled,
        undelivered,
      };
      return failed;
    }
    return endEarly(current, cleanProcessError(appendStderr(message, child.readStderr())), undelivered);
  });

  const consume = (active: Query) =>
    Stream.fromAsyncIterable(
      active as AsyncIterable<SDKMessage>,
      (error) => new ClaudeStreamBroke({ message: describeError(error) })
    ).pipe(
      Stream.runForEach((message) =>
        Effect.andThen(observe(message), message.type === 'result' ? settle(active, message) : Effect.void)
      ),
      Effect.matchEffect({ onFailure: (broke) => crash(broke.message), onSuccess: () => finish })
    );

  const connectServers = (active: Query) =>
    Effect.flatMap(Ref.get(state), (current) =>
      Effect.tryPromise({
        try: () => active.setMcpServers({ ...current.connected }),
        catch: callFailed,
      })
    ).pipe(
      Effect.flatMap((answered) =>
        Effect.forEach(Object.entries(answered.errors), ([server, error]) =>
          Effect.logWarning('[Claude] An MCP server did not connect').pipe(
            Effect.annotateLogs({ server, error })
          )
        )
      ),
      Effect.catchTag('ClaudeCallFailed', (failure) =>
        Effect.logWarning('[Claude] Could not hand the MCP servers to the session').pipe(
          Effect.annotateLogs({ error: failure.message })
        )
      ),
      Effect.ensuring(Deferred.succeed(released, undefined))
    );

  const promptFeed = Stream.fromQueue(prompts);
  const gatedFeed = Stream.unwrap(Effect.as(Deferred.await(released), promptFeed));

  const start = Effect.gen(function* () {
    const process = yield* Effect.tryPromise({
      try: () => resolveClaudeProcess(runtime.resolveExecutable),
      catch: startFailed,
    });
    yield* Ref.update(state, (current) => ({
      ...current,
      ledger: { ...current.ledger, echoes: process.version !== null },
    }));
    const route = yield* Effect.tryPromise({
      try: () => resolveClaudeRoute(input.compaction ?? 'provider', options.eunoe ?? null),
      catch: startFailed,
    });
    if (route.notice) recorder.notify(route.notice);
    yield* Ref.update(state, (current) => ({ ...current, eunoe: route.eunoe }));
    if (route.eunoe && options.eunoe && input.fold && input.resume && !input.fork) {
      const releaseFold = options.eunoe.fold(input.resume, input.cacheWarm ?? false);
      yield* Ref.update(links, (current) => ({ ...current, releaseFold }));
    }
    const queryOptions = resolveQueryOptions(
      input,
      extensions,
      appended,
      route,
      process,
      resolveAccountEnv(input.account?.configDir ?? null),
      child.spawn
    );
    return yield* Effect.try({
      try: () =>
        runtime.runQuery({
          prompt: Stream.toAsyncIterable(hasServers ? gatedFeed : promptFeed),
          options: queryOptions,
        }),
      catch: startFailed,
    });
  });

  const run = Effect.gen(function* () {
    const started = yield* Effect.result(start);
    if (Result.isFailure(started)) {
      const text = started.failure.message;
      input.onEntry({ type: 'error', text });
      const failed: AgentSessionResult = {
        outcome: 'failed',
        summary: text,
        failure: createSetupFailure(text),
      };
      return failed;
    }
    const active = started.success;
    yield* Ref.set(query, active);
    const current = yield* Ref.updateAndGet(state, (latest) => ({ ...latest, started: true }));
    if (current.cancelled) {
      active.close();
      const cancelled: AgentSessionResult = {
        outcome: 'cancelled',
        summary: null,
        undelivered: listUndeliveredSteers(current.ledger),
      };
      return cancelled;
    }
    if (hasServers) yield* connectServers(active);
    yield* Effect.forkIn(recordAccount(active), scope);
    const ended = yield* consume(active).pipe(
      Effect.ensuring(Effect.flatMap(Ref.get(links), (latest) => Effect.sync(() => latest.unwatch?.())))
    );
    const last = yield* Ref.get(state);
    const withUsage: AgentSessionResult = last.usage ? { ...ended, usage: last.usage } : ended;
    if (last.contextTokens === null && last.cacheExpiresAt === null && last.background.size === 0)
      return withUsage;
    const withContext: AgentSessionResult = {
      ...withUsage,
      context: {
        usedTokens: last.contextTokens,
        maxTokens: last.contextWindow,
        cacheExpiresAt: last.cacheExpiresAt,
        backgroundWork: last.background.size > 0,
      },
    };
    return withContext;
  });

  const cleanup = Effect.andThen(
    FiberHandle.clear(exiting),
    Effect.flatMap(Ref.get(links), (latest) => Effect.sync(() => latest.releaseFold?.()))
  );

  yield* send(input.prompt, input.prompt, false);
  input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
  if (input.extensions && input.announceExtensions !== false) {
    recorder.notify({ kind: 'extensions', ...input.extensions.loaded });
  }

  yield* Effect.forkIn(
    detach(run).pipe(
      Effect.tap(() => cleanup),
      Effect.flatMap((ended) => Deferred.succeed(result, ended))
    ),
    scope
  );

  const cancel = detach(
    Effect.andThen(
      Ref.update(state, (current) => ({ ...current, cancelled: true })),
      interrupt
    )
  );

  const requestMcpServers = Effect.fn('ClaudeSession.requestMcpServers')(function* (
    servers: DeferredServer[],
    abandoned: AbortSignal
  ) {
    const active = yield* Ref.get(query);
    if (!active || (yield* Ref.get(state)).closed) {
      return yield* new ClaudeSessionEnded({ message: SESSION_ENDED });
    }
    const names = servers.map((server) => server.claudeName);
    const added: Record<string, McpServerConfig> = Object.fromEntries(
      servers.map((server) => [server.claudeName, serializeClaudeServer(server.definition)])
    );
    const connected = (yield* Ref.updateAndGet(state, (current) => ({
      ...current,
      connected: { ...current.connected, ...added },
    }))).connected;
    const answered = yield* Effect.tryPromise({
      try: () => active.setMcpServers({ ...connected }),
      catch: (error) => new McpServersRefused({ message: describeError(error) }),
    }).pipe(
      Effect.tapError(() =>
        Ref.update(state, (current) => ({ ...current, connected: removeServers(current.connected, names) }))
      )
    );
    const errors = Object.fromEntries(names.map((name) => [name, answered.errors[name] ?? null]));
    const failed = Object.keys(errors).filter((name) => abandoned.aborted || errors[name] !== null);
    yield* Ref.update(state, (current) => ({
      ...current,
      connected: removeServers(current.connected, failed),
    }));
    return errors;
  });

  const steer = Effect.fn('ClaudeSession.steer')(function* (text: string, from: 'you' | 'shinsa') {
    const current = yield* Ref.get(state);
    if (current.closed || current.cancelled) return false;
    input.onEntry({ type: 'user', from, text, attachments: [] });
    yield* send(text, from === 'you' ? resolveSteerPrompt(text) : text, true);
    return true;
  });

  const handle: ClaudeSessionHandle = {
    done: Deferred.await(result),
    steer,
    cancel,
    hasPendingBackgroundWork: Effect.map(Ref.get(state), (current) => current.background.size > 0),
    loadMcpServers: requestMcpServers,
  };

  return yield* Effect.acquireRelease(Effect.succeed(handle), () =>
    Effect.flatMap(Deferred.isDone(result), (finished) =>
      finished ? Effect.void : Effect.andThen(cancel, Deferred.await(result))
    )
  );
});
