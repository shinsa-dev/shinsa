import { type ChatEvent, resolveSteerPrompt, type RunFailure } from '@shinsa/core';
import { Deferred, Effect, FiberSet, Option, Ref, Result, Scope } from 'effect';
import { resolveDeferredInstructions } from '../../../../extensions/session.ts';
import { describeError } from '../../../../log/index.ts';
import { resolveForbiddenReason } from '../../../policy.ts';
import { resolveSkillInstructions, SHINSA_INSTRUCTIONS } from '../../instructions.ts';
import type { AgentSessionResult } from '../../types.ts';
import {
  type CodexTurnError,
  createInterruption,
  createLostSession,
  createSetupFailure,
  createTransportFailure,
  isMissingThread,
  resolveCodexFailure,
} from '../classify.ts';
import { type CodexConnection, type CodexParams, CodexRequestError } from '../client/schema.ts';
import { makeCodexClient } from '../client/service.ts';
import { resolveCodexServerConfig, resolveCodexSkillInstructions } from '../extensions.ts';
import { type CodexItem, type CodexPlanStep, createCodexRecorder } from '../map.ts';
import type { ToolEndpointHandle } from '../mcp/schema.ts';
import { makeToolEndpoint } from '../mcp/service.ts';
import { createCodexMeter } from '../meter.ts';
import { readRecord } from '../params.ts';
import { resolveCacheLifetimeMs } from '../pricing.ts';
import { CODEX_WINDOW_KEYS } from '../usage/schema.ts';
import {
  BUFFER_LIMIT,
  type BufferedEvent,
  type CodexSessionDefinition,
  type CodexSessionHandle,
  type ContextReading,
  FAST_TIER,
  NEVER_COMPACT_TOKENS,
  type QueuedPrompt,
  STREAM_ENDED,
  SUMMARY_LIMIT,
  TOOL_TIMEOUT_SEC,
  type TurnEnd,
} from './schema.ts';

export const makeCodexSession = Effect.fn('CodexSession.make')(function* (
  definition: CodexSessionDefinition
) {
  const { input, mode } = definition;
  const scope = yield* Effect.scope;
  const services = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(services);
  const runPromise = Effect.runPromiseWith(services);
  const compacting = mode === 'compact';
  const recorder = createCodexRecorder(input.onEntry, input.storeImage, compacting ? 'manual' : 'auto');
  const meter = createCodexMeter(input.usageBaseline);
  const queue = yield* Ref.make<readonly QueuedPrompt[]>(
    compacting ? [] : [{ text: input.prompt, wire: input.prompt, steer: false }]
  );
  const steering = yield* FiberSet.make<void>();
  const turns = yield* Ref.make<ReadonlyMap<string, Deferred.Deferred<TurnEnd>>>(new Map());
  const buffered = yield* Ref.make<ReadonlyMap<string, readonly BufferedEvent[]>>(new Map());
  const exit = yield* Deferred.make<string>();
  const compaction = yield* Deferred.make<TurnEnd>();
  const connection = yield* Ref.make(Option.none<CodexConnection>());
  const endpoint = yield* Ref.make(Option.none<ToolEndpointHandle>());
  const threadId = yield* Ref.make<string | null>(null);
  const turnId = yield* Ref.make<string | null>(null);
  const model = yield* Ref.make(input.model);
  const fast = yield* Ref.make(false);
  const cancelled = yield* Ref.make(false);
  const closed = yield* Ref.make(false);
  const context = yield* Ref.make<ContextReading | null>(null);
  const lastRequestAt = yield* Ref.make<number | null>(null);
  const turnError = yield* Ref.make<CodexTurnError | null>(null);
  const lastLimit = yield* Ref.make('');

  const record = (entry: ChatEvent) => Effect.sync(() => input.onEntry(entry));

  const readNumber = (fields: CodexParams, key: string) => {
    const value = fields[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };

  const readOptionalText = (fields: CodexParams, key: string) => {
    const value = fields[key];
    return typeof value === 'string' && value ? value : null;
  };

  const textInput = (text: string) => [{ type: 'text', text, text_elements: [] }];

  const resolveContext = (tokenUsage: CodexParams): ContextReading | null => {
    const used = readNumber(readRecord(tokenUsage.last), 'totalTokens');
    if (used <= 0) return null;
    const max = readNumber(tokenUsage, 'modelContextWindow');
    const total = readNumber(readRecord(tokenUsage.total), 'totalTokens');
    return {
      usedTokens: used,
      maxTokens: max > 0 ? max : null,
      totalProcessedTokens: total > used ? total : null,
    };
  };

  const resolveDeveloperInstructions = () => {
    const skills = input.extensions
      ? resolveCodexSkillInstructions(input.extensions)
      : resolveSkillInstructions(input.pluginDir);
    const deferred = input.extensions ? resolveDeferredInstructions(input.extensions) : null;
    return [SHINSA_INSTRUCTIONS, skills, deferred].filter(Boolean).join('\n\n');
  };

  const resolveThreadParams = (tools: ToolEndpointHandle): CodexParams => ({
    cwd: input.cwd,
    ...(input.model ? { model: input.model } : {}),
    serviceTier: input.fastMode ? FAST_TIER : null,
    approvalPolicy: input.readOnly ? 'never' : 'untrusted',
    sandbox: input.readOnly ? 'read-only' : 'danger-full-access',
    developerInstructions: resolveDeveloperInstructions(),
    config: {
      ...resolveCodexServerConfig(input.extensions),
      'mcp_servers.shinsa': {
        url: tools.url,
        http_headers: tools.headers,
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
        default_tools_approval_mode: 'approve',
      },
      ...(input.compaction === 'off' ? { model_auto_compact_token_limit: NEVER_COMPACT_TOKENS } : {}),
    },
  });

  const resolveThreadMethod = () => {
    if (!input.resume) return 'thread/start';
    return input.fork ? 'thread/fork' : 'thread/resume';
  };

  const turnOf = (id: string) =>
    Ref.modify(
      turns,
      (open): [Deferred.Deferred<TurnEnd>, ReadonlyMap<string, Deferred.Deferred<TurnEnd>>] => {
        const existing = open.get(id);
        if (existing) return [existing, open];
        const created = Deferred.makeUnsafe<TurnEnd>();
        return [created, new Map(open).set(id, created)];
      }
    );

  const recordRateLimits = Effect.fn('CodexSession.recordRateLimits')(function* (snapshot: CodexParams) {
    for (const window of [readRecord(snapshot.primary), readRecord(snapshot.secondary)]) {
      const percent = readNumber(window, 'usedPercent');
      const minutes = readNumber(window, 'windowDurationMins');
      const resetsAt = readNumber(window, 'resetsAt');
      const key = `${minutes}:${percent >= 100}:${resetsAt}`;
      const seen = yield* Ref.get(lastLimit);
      if (minutes === 0 || seen.includes(key)) continue;
      yield* Ref.set(lastLimit, `${seen}|${key}`);
      yield* record({
        type: 'notice',
        notice: {
          kind: 'rate_limit',
          status: percent >= 100 ? 'rejected' : 'allowed',
          limit: CODEX_WINDOW_KEYS[minutes] ?? `${minutes}m`,
          resetsAt: resetsAt > 0 ? resetsAt * 1000 : null,
          utilization: percent / 100,
        },
      });
    }
  });

  const buffer = (thread: string, method: string, params: CodexParams) =>
    Ref.update(buffered, (held) => {
      const count = [...held.values()].reduce((sum, events) => sum + events.length, 0);
      if (count >= BUFFER_LIMIT) return held;
      return new Map(held).set(thread, [...(held.get(thread) ?? []), { method, params }]);
    });

  const replayFollowed: () => Effect.Effect<void> = Effect.fn('CodexSession.replayFollowed')(function* () {
    const followed = yield* Ref.modify(
      buffered,
      (held): [[string, readonly BufferedEvent[]][], ReadonlyMap<string, readonly BufferedEvent[]>] => {
        const ready = [...held].filter(([thread]) => recorder.isAgent(thread));
        return [ready, new Map([...held].filter(([thread]) => !recorder.isAgent(thread)))];
      }
    );
    for (const [thread, events] of followed) {
      for (const event of events) yield* observeAgent(thread, event.method, event.params);
    }
  });

  const observeAgent = Effect.fn('CodexSession.observeAgent')(function* (
    thread: string,
    method: string,
    params: CodexParams
  ) {
    if (!recorder.isAgent(thread)) return yield* buffer(thread, method, params);
    switch (method) {
      case 'item/started':
        recorder.started(params.item as CodexItem, thread);
        return;
      case 'item/completed':
        recorder.completed(params.item as CodexItem, thread);
        return yield* replayFollowed();
      case 'thread/tokenUsage/updated': {
        const running = recorder.agentModel(thread) ?? (yield* Ref.get(model));
        meter.record(thread, readRecord(params.tokenUsage), running, yield* Ref.get(fast));
        return;
      }
      case 'turn/completed':
        recorder.endAgentTurn(thread, readRecord(params.turn).status !== 'completed');
        return;
      default:
        return;
    }
  });

  const endCompaction = Effect.fn('CodexSession.endCompaction')(function* (end: TurnEnd) {
    if (!compacting) return false;
    yield* Deferred.succeed(compaction, end);
    return true;
  });

  const completeItem = Effect.fn('CodexSession.completeItem')(function* (item: CodexItem) {
    recorder.completed(item);
    yield* replayFollowed();
    if (item.type !== 'contextCompaction' || !compacting) return;
    yield* Effect.forkIn(
      Effect.sleep(definition.compactGrace).pipe(
        Effect.andThen(endCompaction({ status: 'completed', error: null }))
      ),
      scope
    );
  });

  const recordTokens = Effect.fn('CodexSession.recordTokens')(function* (
    thread: string,
    tokenUsage: CodexParams
  ) {
    meter.record(thread, tokenUsage, yield* Ref.get(model), yield* Ref.get(fast));
    yield* Ref.update(context, (current) => resolveContext(tokenUsage) ?? current);
    yield* Ref.set(lastRequestAt, yield* definition.now);
  });

  const completeTurn = Effect.fn('CodexSession.completeTurn')(function* (turn: CodexParams) {
    const error = turn.error ? (readRecord(turn.error) as CodexTurnError) : null;
    const end = { status: String(turn.status), error };
    if (yield* endCompaction(end)) return;
    yield* Deferred.succeed(yield* turnOf(String(turn.id)), end);
  });

  const observeThread = Effect.fn('CodexSession.observeThread')(function* (
    thread: string,
    method: string,
    params: CodexParams
  ) {
    switch (method) {
      case 'item/started':
        recorder.started(params.item as CodexItem);
        return;
      case 'item/completed':
        return yield* completeItem(params.item as CodexItem);
      case 'turn/plan/updated':
        recorder.plan(
          String(params.turnId),
          Array.isArray(params.plan) ? (params.plan as CodexPlanStep[]) : []
        );
        return;
      case 'thread/tokenUsage/updated':
        return yield* recordTokens(thread, readRecord(params.tokenUsage));
      case 'model/rerouted':
        return yield* Ref.update(model, (current) => readOptionalText(params, 'toModel') ?? current);
      case 'thread/compacted':
        recorder.compacted();
        return;
      case 'error':
        if (params.willRetry !== true) yield* Ref.set(turnError, readRecord(params.error) as CodexTurnError);
        return;
      case 'turn/completed':
        return yield* completeTurn(readRecord(params.turn));
      default:
        return;
    }
  });

  const observe = Effect.fn('CodexSession.observe')(function* (method: string, params: CodexParams) {
    input.onActivity?.();
    if (method === 'account/rateLimits/updated')
      return yield* recordRateLimits(readRecord(params.rateLimits));
    const thread = readOptionalText(params, 'threadId');
    const own = yield* Ref.get(threadId);
    if (thread === null || own === null) return;
    if (thread !== own) return yield* observeAgent(thread, method, params);
    yield* observeThread(thread, method, params);
  });

  const selectActive = Effect.gen(function* () {
    const client = yield* Ref.get(connection);
    const thread = yield* Ref.get(threadId);
    const turn = yield* Ref.get(turnId);
    if (Option.isNone(client) || thread === null || turn === null) return Option.none();
    return Option.some({ client: client.value, thread, turn });
  });

  const warnAgent = Effect.fn('CodexSession.warnAgent')(function* (command: string, reason: string) {
    const active = yield* selectActive;
    if (Option.isNone(active)) return;
    const { client, thread, turn } = active.value;
    const text = `<system-message>Shinsa blocked \`${command}\`: ${reason}</system-message>`;
    yield* Effect.forkIn(
      client
        .request('turn/steer', { threadId: thread, expectedTurnId: turn, input: textInput(text) })
        .pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Codex] Could not tell the agent why a command was blocked').pipe(
              Effect.annotateLogs({ error: describeError(failure) })
            )
          )
        ),
      scope
    );
  });

  const answer = Effect.fn('CodexSession.answer')(function* (method: string, params: CodexParams) {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        if (typeof params.command !== 'string') return { decision: 'decline' };
        const reason = resolveForbiddenReason(params.command, input.defaultBranch);
        if (reason) yield* warnAgent(params.command, reason);
        return { decision: reason ? 'decline' : 'accept' };
      }
      case 'item/fileChange/requestApproval':
        return { decision: input.readOnly ? 'decline' : 'accept' };
      case 'mcpServer/elicitation/request': {
        const ours = params.serverName === 'shinsa';
        return { action: ours ? 'accept' : 'decline', content: ours ? {} : null, _meta: null };
      }
      default:
        return yield* new CodexRequestError({
          method,
          message: `Shinsa does not answer ${method}: nobody watches this agent.`,
        });
    }
  });

  const openThread = Effect.fn('CodexSession.openThread')(function* (
    active: CodexConnection,
    tools: ToolEndpointHandle
  ) {
    const params = resolveThreadParams(tools);
    const response = readRecord(
      yield* active.request(
        resolveThreadMethod(),
        input.resume ? { threadId: input.resume, ...params } : params
      )
    );
    const offered = response.serviceTier === FAST_TIER;
    yield* Ref.set(fast, offered);
    yield* Ref.update(model, (current) => readOptionalText(response, 'model') ?? current);
    if (input.fastMode && !offered && !compacting) {
      yield* record({
        type: 'notice',
        notice: { kind: 'fast_mode', status: 'unavailable', reason: 'tier_not_offered' },
      });
    }
    return String(readRecord(response.thread).id);
  });

  const recordContext = Effect.flatMap(Ref.get(context), (reading) =>
    reading ? record({ type: 'notice', notice: { kind: 'context', ...reading } }) : Effect.void
  );

  const listUndelivered = Effect.map(Ref.get(queue), (prompts) =>
    prompts.filter((prompt) => prompt.steer).map((prompt) => prompt.text)
  );

  const fail = Effect.fn('CodexSession.fail')(function* (failure: RunFailure, entry = true) {
    recorder.flush('interim');
    if (entry) yield* record({ type: 'error', text: failure.message });
    const result: AgentSessionResult = {
      outcome: 'failed',
      summary: failure.message,
      failure,
      undelivered: yield* listUndelivered,
    };
    return result;
  });

  const stopped = Effect.gen(function* () {
    recorder.flush('interim');
    const result: AgentSessionResult = {
      outcome: 'cancelled',
      summary: null,
      undelivered: yield* listUndelivered,
    };
    return result;
  });

  const awaitEnd = (ending: Deferred.Deferred<TurnEnd>) =>
    Effect.raceFirst(Deferred.await(ending), Deferred.await(exit));

  const runTurn = Effect.fn('CodexSession.runTurn')(function* (
    active: CodexConnection,
    thread: string,
    prompt: QueuedPrompt
  ) {
    yield* Ref.set(turnError, null);
    const started = yield* Effect.result(
      active.request('turn/start', { threadId: thread, input: textInput(prompt.wire) })
    );
    if (Result.isFailure(started)) {
      if (yield* Ref.get(cancelled)) return yield* stopped;
      yield* Ref.update(queue, (prompts) => [prompt, ...prompts]);
      return yield* fail(createTransportFailure(describeError(started.failure)));
    }
    const turn = String(readRecord(readRecord(started.success).turn).id);
    yield* Ref.set(turnId, turn);
    const ended = yield* awaitEnd(yield* turnOf(turn));
    yield* Ref.set(turnId, null);
    yield* FiberSet.awaitEmpty(steering);
    if (yield* Ref.get(cancelled)) return yield* stopped;
    if (typeof ended === 'string')
      return yield* fail(createTransportFailure(`${STREAM_ENDED} ${ended}`.trim()));
    if (ended.status === 'completed') {
      recorder.endTurn();
      yield* recordContext;
      return null;
    }
    yield* recordContext;
    if (ended.status === 'interrupted') {
      yield* record({ type: 'notice', notice: { kind: 'interrupted' } });
      return yield* fail(createInterruption(), false);
    }
    return yield* fail(resolveCodexFailure(ended.error ?? (yield* Ref.get(turnError))));
  });

  const runTurns = Effect.fn('CodexSession.runTurns')(function* (active: CodexConnection, thread: string) {
    for (;;) {
      yield* FiberSet.awaitEmpty(steering);
      const prompt = yield* Ref.modify(
        queue,
        ([first, ...rest]): [QueuedPrompt | undefined, QueuedPrompt[]] => [first, rest]
      );
      if (!prompt) break;
      const result = yield* runTurn(active, thread, prompt);
      if (result) return result;
    }
    yield* Ref.set(closed, true);
    const result: AgentSessionResult = {
      outcome: 'completed',
      summary: recorder.lastText()?.slice(0, SUMMARY_LIMIT) ?? null,
      undelivered: [],
    };
    return result;
  });

  const runCompaction = Effect.fn('CodexSession.runCompaction')(function* (
    active: CodexConnection,
    thread: string
  ) {
    const asked = yield* Effect.result(active.request('thread/compact/start', { threadId: thread }));
    if (Result.isFailure(asked)) {
      if (yield* Ref.get(cancelled)) return yield* stopped;
      return yield* fail(
        createTransportFailure(`Codex could not compact the thread: ${describeError(asked.failure)}`)
      );
    }
    const ended = yield* awaitEnd(compaction);
    yield* Ref.set(closed, true);
    if (yield* Ref.get(cancelled)) return yield* stopped;
    if (typeof ended === 'string')
      return yield* fail(createTransportFailure(`${STREAM_ENDED} ${ended}`.trim()));
    if (ended.status !== 'completed') {
      return yield* fail(resolveCodexFailure(ended.error ?? (yield* Ref.get(turnError))));
    }
    const result: AgentSessionResult = { outcome: 'completed', summary: null, undelivered: [] };
    return result;
  });

  const connect = Effect.fn('CodexSession.connect')(function* (path: string) {
    const tools = yield* makeToolEndpoint({
      tools: input.tools,
      heartbeat: definition.heartbeat,
      token: yield* definition.token,
    });
    yield* Ref.set(endpoint, Option.some(tools));
    const active = yield* makeCodexClient(
      { path, cwd: input.cwd, env: definition.env, browserEndpoint: input.browserEndpoint ?? null },
      {
        notification: (method, params) => runSync(observe(method, params)),
        request: (method, params) => runPromise(answer(method, params)),
        exit: (message) => runSync(Deferred.succeed(exit, message)),
      }
    );
    yield* Ref.set(connection, Option.some(active));
    input.onProcess?.(active.pid);
    yield* active.initialize;
    const thread = yield* openThread(active, tools);
    yield* Ref.set(threadId, thread);
    return { active, thread };
  });

  const start = Effect.gen(function* () {
    const executable = yield* definition.executable;
    if (!executable.ok) return yield* fail(createSetupFailure(executable.message, executable.reason));
    if (yield* Ref.get(cancelled)) return yield* stopped;
    const opened = yield* Effect.result(connect(executable.path).pipe(Scope.provide(scope)));
    if (Result.isFailure(opened)) {
      if (yield* Ref.get(cancelled)) return yield* stopped;
      if (isMissingThread(opened.failure)) return yield* fail(createLostSession(), false);
      return yield* fail(createSetupFailure(`Codex could not start: ${describeError(opened.failure)}`));
    }
    const { active, thread } = opened.success;
    input.onSession(thread);
    return yield* compacting ? runCompaction(active, thread) : runTurns(active, thread);
  });

  const release = Effect.gen(function* () {
    yield* Ref.set(closed, true);
    recorder.closeAgents();
    const client = yield* Ref.get(connection);
    if (Option.isSome(client)) yield* client.value.close;
    const tools = yield* Ref.get(endpoint);
    if (Option.isSome(tools)) yield* tools.value.close;
  });

  const resolveSessionContext = Effect.gen(function* () {
    const reading = yield* Ref.get(context);
    if (!reading) return null;
    const requestedAt = yield* Ref.get(lastRequestAt);
    return {
      usedTokens: reading.usedTokens,
      maxTokens: reading.maxTokens,
      cacheExpiresAt:
        requestedAt === null ? null : requestedAt + resolveCacheLifetimeMs(yield* Ref.get(model)),
      backgroundWork: false,
    };
  });

  const run = Effect.gen(function* () {
    const result = yield* Effect.ensuring(start, release);
    const thread = yield* Ref.get(threadId);
    const usage = thread ? meter.usage(thread) : null;
    const subagents = meter.listOthers(thread);
    const measured = yield* resolveSessionContext;
    const ended: AgentSessionResult = {
      ...result,
      ...(usage ? { usage } : {}),
      ...(subagents.length > 0 ? { subagentUsage: subagents } : {}),
      ...(measured ? { context: measured } : {}),
    };
    return ended;
  });

  const steer = Effect.fn('CodexSession.steer')(function* (text: string, from: 'you' | 'shinsa') {
    if (compacting || (yield* Ref.get(closed)) || (yield* Ref.get(cancelled))) return false;
    yield* record({ type: 'user', from, text, attachments: [] });
    const prompt = { text, wire: from === 'you' ? resolveSteerPrompt(text) : text, steer: true };
    const active = yield* selectActive;
    if (Option.isNone(active)) {
      yield* Ref.update(queue, (prompts) => [...prompts, prompt]);
      return true;
    }
    const { client, thread, turn } = active.value;
    yield* FiberSet.run(
      steering,
      client
        .request('turn/steer', { threadId: thread, expectedTurnId: turn, input: textInput(prompt.wire) })
        .pipe(
          Effect.asVoid,
          Effect.catch((failure) =>
            Effect.logInfo(
              '[Codex] The turn could not be steered; the message goes in as the next turn'
            ).pipe(
              Effect.annotateLogs({ error: describeError(failure) }),
              Effect.andThen(Ref.update(queue, (prompts) => [...prompts, prompt]))
            )
          )
        )
    );
    return true;
  });

  const cancel = Effect.gen(function* () {
    yield* Ref.set(cancelled, true);
    const active = yield* selectActive;
    if (Option.isSome(active)) {
      const { client, thread, turn } = active.value;
      yield* client.request('turn/interrupt', { threadId: thread, turnId: turn }).pipe(
        Effect.asVoid,
        Effect.catch((failure) =>
          Effect.logWarning('[Codex] Could not interrupt the turn').pipe(
            Effect.annotateLogs({ error: describeError(failure) })
          )
        ),
        Effect.timeoutOption(definition.requestTimeout)
      );
    }
    const client = yield* Ref.get(connection);
    if (Option.isSome(client)) yield* client.value.close;
    yield* Deferred.succeed(exit, 'cancelled');
  });

  if (!compacting) yield* record({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
  if (!compacting && input.extensions && input.announceExtensions !== false) {
    yield* record({
      type: 'notice',
      notice: { kind: 'extensions', ...input.extensions.loaded, plugins: [] },
    });
  }

  const ended = yield* Deferred.make<AgentSessionResult>();
  yield* Effect.forkIn(
    Effect.flatMap(run, (result) => Deferred.succeed(ended, result)),
    scope
  );

  const handle: CodexSessionHandle = { done: Deferred.await(ended), steer, cancel };
  return handle;
});
