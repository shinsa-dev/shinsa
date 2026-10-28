import { type RunFailure, resolveSteerPrompt } from '@shinsa/core';
import { resolveDeferredInstructions } from '../../../extensions/index.ts';
import { describeError, log } from '../../../log/index.ts';
import { resolveForbiddenReason } from '../../policy.ts';
import { resolveSkillInstructions, SHINSA_INSTRUCTIONS } from '../instructions.ts';
import type { AgentSession, AgentSessionInput, AgentSessionResult } from '../types.ts';
import {
  type CodexTurnError,
  createInterruption,
  createLostSession,
  createSetupFailure,
  createTransportFailure,
  isMissingThread,
  resolveCodexFailure,
} from './classify.ts';
import { CodexClient, readRecord } from './client.ts';
import { type CodexExecutableResolver, resolveCodexExecutable } from './executable.ts';
import { resolveCodexServerConfig, resolveCodexSkillInstructions } from './extensions.ts';
import { type CodexItem, type CodexPlanStep, createCodexRecorder } from './map.ts';
import { startToolEndpoint, type ToolEndpoint } from './mcp.ts';
import { CodexMeter } from './meter.ts';
import { resolveCacheLifetimeMs } from './pricing.ts';
import { CODEX_WINDOW_KEYS } from './usage.ts';

export interface CodexRuntime {
  resolveExecutable: CodexExecutableResolver;
  env?: Record<string, string | undefined>;
}

export const CODEX_RUNTIME: CodexRuntime = { resolveExecutable: () => resolveCodexExecutable() };

export interface CodexSessionOptions {
  runtime?: CodexRuntime;
  requestTimeoutMs?: number;
  heartbeatMs?: number;
  compactGraceMs?: number;
  now?: () => number;
}

export type CodexSessionMode = 'turns' | 'compact';

interface QueuedPrompt {
  text: string;
  wire: string;
  steer: boolean;
}

interface TurnEnd {
  status: string;
  error: CodexTurnError | null;
}

type Params = Record<string, unknown>;

interface ContextReading {
  usedTokens: number;
  maxTokens: number | null;
  totalProcessedTokens: number | null;
}

interface Buffered {
  method: string;
  params: Params;
}

const SUMMARY_LIMIT = 2000;

const REQUEST_TIMEOUT_MS = 5_000;

const COMPACT_GRACE_MS = 5_000;

const TOOL_TIMEOUT_SEC = 24 * 60 * 60;

const BUFFER_LIMIT = 500;

const STREAM_ENDED = 'The agent’s process ended before it finished its turn.';

function readNumber(record: Params, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readOptionalText(record: Params, key: string) {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

function textInput(text: string) {
  return [{ type: 'text', text, text_elements: [] }];
}

function resolveContext(tokenUsage: Params): ContextReading | null {
  const used = readNumber(readRecord(tokenUsage.last), 'totalTokens');
  if (used <= 0) return null;
  const max = readNumber(tokenUsage, 'modelContextWindow');
  const total = readNumber(readRecord(tokenUsage.total), 'totalTokens');
  return {
    usedTokens: used,
    maxTokens: max > 0 ? max : null,
    totalProcessedTokens: total > used ? total : null,
  };
}

export const FAST_TIER = 'fast';

const NEVER_COMPACT_TOKENS = Number.MAX_SAFE_INTEGER;

function resolveDeveloperInstructions(input: AgentSessionInput) {
  const skills = input.extensions
    ? resolveCodexSkillInstructions(input.extensions)
    : resolveSkillInstructions(input.pluginDir);
  const deferred = input.extensions ? resolveDeferredInstructions(input.extensions) : null;
  return [SHINSA_INSTRUCTIONS, skills, deferred].filter(Boolean).join('\n\n');
}

function resolveThreadParams(input: AgentSessionInput, endpoint: ToolEndpoint): Params {
  return {
    cwd: input.cwd,
    ...(input.model ? { model: input.model } : {}),
    serviceTier: input.fastMode ? FAST_TIER : null,
    approvalPolicy: input.readOnly ? 'never' : 'untrusted',
    sandbox: input.readOnly ? 'read-only' : 'danger-full-access',
    developerInstructions: resolveDeveloperInstructions(input),
    config: {
      ...resolveCodexServerConfig(input.extensions),
      'mcp_servers.shinsa': {
        url: endpoint.url,
        http_headers: endpoint.headers,
        tool_timeout_sec: TOOL_TIMEOUT_SEC,
        default_tools_approval_mode: 'approve',
      },
      ...(input.compaction === 'off' ? { model_auto_compact_token_limit: NEVER_COMPACT_TOKENS } : {}),
    },
  };
}

function resolveThreadMethod(input: AgentSessionInput) {
  if (!input.resume) return 'thread/start';
  return input.fork ? 'thread/fork' : 'thread/resume';
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms).unref());
}

export function startCodexSession(
  input: AgentSessionInput,
  options: CodexSessionOptions = {},
  mode: CodexSessionMode = 'turns'
): AgentSession {
  const runtime = options.runtime ?? CODEX_RUNTIME;
  const now = options.now ?? Date.now;
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const compacting = mode === 'compact';
  const recorder = createCodexRecorder(input.onEntry, input.storeImage, compacting ? 'manual' : 'auto');
  const meter = new CodexMeter(input.usageBaseline);
  const queue: QueuedPrompt[] = compacting ? [] : [{ text: input.prompt, wire: input.prompt, steer: false }];
  const steering = new Set<Promise<void>>();
  const turns = new Map<string, ReturnType<typeof Promise.withResolvers<TurnEnd>>>();
  const buffered = new Map<string, Buffered[]>();
  const exit = Promise.withResolvers<string>();
  const compaction = Promise.withResolvers<TurnEnd>();
  let client: CodexClient | null = null;
  let endpoint: ToolEndpoint | null = null;
  let threadId: string | null = null;
  let turnId: string | null = null;
  let model = input.model;
  let fast = false;
  let cancelled = false;
  let closed = false;
  let context: ContextReading | null = null;
  let lastRequestAt: number | null = null;
  let turnError: CodexTurnError | null = null;
  let bufferedCount = 0;
  let lastLimit = '';

  if (!compacting) input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
  if (!compacting && input.extensions && input.announceExtensions !== false) {
    input.onEntry({
      type: 'notice',
      notice: { kind: 'extensions', ...input.extensions.loaded, plugins: [] },
    });
  }

  const turnOf = (id: string) => {
    let entry = turns.get(id);
    if (!entry) {
      entry = Promise.withResolvers<TurnEnd>();
      turns.set(id, entry);
    }
    return entry;
  };

  const recordRateLimits = (snapshot: Params) => {
    for (const window of [readRecord(snapshot.primary), readRecord(snapshot.secondary)]) {
      const percent = readNumber(window, 'usedPercent');
      const minutes = readNumber(window, 'windowDurationMins');
      const resetsAt = readNumber(window, 'resetsAt');
      const key = `${minutes}:${percent >= 100}:${resetsAt}`;
      if (minutes === 0 || lastLimit.includes(key)) continue;
      lastLimit = `${lastLimit}|${key}`;
      input.onEntry({
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
  };

  const buffer = (thread: string, method: string, params: Params) => {
    if (bufferedCount >= BUFFER_LIMIT) return;
    bufferedCount += 1;
    buffered.set(thread, [...(buffered.get(thread) ?? []), { method, params }]);
  };

  const replayFollowed = () => {
    for (const [thread, events] of buffered) {
      if (!recorder.isAgent(thread)) continue;
      buffered.delete(thread);
      bufferedCount -= events.length;
      for (const event of events) observeAgent(thread, event.method, event.params);
    }
  };

  const observeAgent = (thread: string, method: string, params: Params) => {
    if (!recorder.isAgent(thread)) {
      buffer(thread, method, params);
      return;
    }
    switch (method) {
      case 'item/started':
        recorder.started(params.item as CodexItem, thread);
        return;
      case 'item/completed':
        recorder.completed(params.item as CodexItem, thread);
        replayFollowed();
        return;
      case 'thread/tokenUsage/updated':
        meter.record(thread, readRecord(params.tokenUsage), recorder.agentModel(thread) ?? model, fast);
        return;
      case 'turn/completed':
        recorder.endAgentTurn(thread, readRecord(params.turn).status !== 'completed');
        return;
      default:
        return;
    }
  };

  const endCompaction = (end: TurnEnd) => {
    if (!compacting) return false;
    compaction.resolve(end);
    return true;
  };

  const observe = (method: string, params: Params) => {
    input.onActivity?.();
    if (method === 'account/rateLimits/updated') {
      recordRateLimits(readRecord(params.rateLimits));
      return;
    }
    const thread = readOptionalText(params, 'threadId');
    if (thread === null || threadId === null) return;
    if (thread !== threadId) {
      observeAgent(thread, method, params);
      return;
    }
    observeThread(thread, method, params);
  };

  const completeItem = (item: CodexItem) => {
    recorder.completed(item);
    replayFollowed();
    if (item.type !== 'contextCompaction' || !compacting) return;
    void wait(options.compactGraceMs ?? COMPACT_GRACE_MS).then(() =>
      endCompaction({ status: 'completed', error: null })
    );
  };

  const recordTokens = (thread: string, tokenUsage: Params) => {
    meter.record(thread, tokenUsage, model, fast);
    context = resolveContext(tokenUsage) ?? context;
    lastRequestAt = now();
  };

  const completeTurn = (turn: Params) => {
    const error = turn.error ? (readRecord(turn.error) as CodexTurnError) : null;
    const end = { status: String(turn.status), error };
    if (!endCompaction(end)) turnOf(String(turn.id)).resolve(end);
  };

  const observeThread = (thread: string, method: string, params: Params) => {
    switch (method) {
      case 'item/started':
        recorder.started(params.item as CodexItem);
        return;
      case 'item/completed':
        completeItem(params.item as CodexItem);
        return;
      case 'turn/plan/updated':
        recorder.plan(
          String(params.turnId),
          Array.isArray(params.plan) ? (params.plan as CodexPlanStep[]) : []
        );
        return;
      case 'thread/tokenUsage/updated':
        recordTokens(thread, readRecord(params.tokenUsage));
        return;
      case 'model/rerouted':
        model = readOptionalText(params, 'toModel') ?? model;
        return;
      case 'thread/compacted':
        recorder.compacted();
        return;
      case 'error':
        if (params.willRetry !== true) turnError = readRecord(params.error) as CodexTurnError;
        return;
      case 'turn/completed':
        completeTurn(readRecord(params.turn));
        return;
      default:
        return;
    }
  };

  const warnAgent = (command: string, reason: string) => {
    const active = turnId;
    if (!client || !threadId || !active) return;
    const text = `<system-message>Shinsa blocked \`${command}\`: ${reason}</system-message>`;
    client
      .request('turn/steer', { threadId, expectedTurnId: active, input: textInput(text) })
      .catch((error: unknown) => {
        log.warn('[Codex] Could not tell the agent why a command was blocked', {
          error: describeError(error),
        });
      });
  };

  const answer = (method: string, params: Params): Promise<unknown> => {
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        if (typeof params.command !== 'string') return Promise.resolve({ decision: 'decline' });
        const reason = resolveForbiddenReason(params.command, input.defaultBranch);
        if (reason) warnAgent(params.command, reason);
        return Promise.resolve({ decision: reason ? 'decline' : 'accept' });
      }
      case 'item/fileChange/requestApproval':
        return Promise.resolve({ decision: input.readOnly ? 'decline' : 'accept' });
      case 'mcpServer/elicitation/request': {
        const ours = params.serverName === 'shinsa';
        return Promise.resolve({
          action: ours ? 'accept' : 'decline',
          content: ours ? {} : null,
          _meta: null,
        });
      }
      default:
        return Promise.reject(new Error(`Shinsa does not answer ${method}: nobody watches this agent.`));
    }
  };

  const openThread = async (active: CodexClient, tools: ToolEndpoint) => {
    const params = resolveThreadParams(input, tools);
    const method = resolveThreadMethod(input);
    const response = await active.request(
      method,
      input.resume ? { threadId: input.resume, ...params } : params
    );
    fast = response.serviceTier === FAST_TIER;
    model = readOptionalText(response, 'model') ?? model;
    if (input.fastMode && !fast && !compacting) {
      input.onEntry({
        type: 'notice',
        notice: { kind: 'fast_mode', status: 'unavailable', reason: 'tier_not_offered' },
      });
    }
    return String(readRecord(response.thread).id);
  };

  const recordContext = () => {
    if (!context) return;
    input.onEntry({ type: 'notice', notice: { kind: 'context', ...context } });
  };

  const listUndelivered = () => queue.filter((prompt) => prompt.steer).map((prompt) => prompt.text);

  const fail = (failure: RunFailure, entry = true): AgentSessionResult => {
    recorder.flush('interim');
    if (entry) input.onEntry({ type: 'error', text: failure.message });
    return { outcome: 'failed', summary: failure.message, failure, undelivered: listUndelivered() };
  };

  const stopped = (): AgentSessionResult => {
    recorder.flush('interim');
    return { outcome: 'cancelled', summary: null, undelivered: listUndelivered() };
  };

  const runTurn = async (active: CodexClient, thread: string, prompt: QueuedPrompt) => {
    turnError = null;
    let started: Params;
    try {
      started = await active.request('turn/start', { threadId: thread, input: textInput(prompt.wire) });
    } catch (error) {
      if (cancelled) return stopped();
      queue.unshift(prompt);
      return fail(createTransportFailure(describeError(error)));
    }
    turnId = String(readRecord(started.turn).id);
    const ended = await Promise.race([turnOf(turnId).promise, exit.promise]);
    turnId = null;
    await Promise.allSettled([...steering]);
    if (cancelled) return stopped();
    if (typeof ended === 'string') return fail(createTransportFailure(`${STREAM_ENDED} ${ended}`.trim()));
    if (ended.status === 'completed') {
      recorder.endTurn();
      recordContext();
      return null;
    }
    recordContext();
    if (ended.status === 'interrupted') {
      input.onEntry({ type: 'notice', notice: { kind: 'interrupted' } });
      return fail(createInterruption(), false);
    }
    return fail(resolveCodexFailure(ended.error ?? turnError));
  };

  const runTurns = async (active: CodexClient, thread: string): Promise<AgentSessionResult> => {
    for (;;) {
      await Promise.allSettled([...steering]);
      const prompt = queue.shift();
      if (!prompt) break;
      const result = await runTurn(active, thread, prompt);
      if (result) return result;
    }
    closed = true;
    const summary = recorder.lastText()?.slice(0, SUMMARY_LIMIT) ?? null;
    return { outcome: 'completed', summary, undelivered: [] };
  };

  const runCompaction = async (active: CodexClient, thread: string): Promise<AgentSessionResult> => {
    try {
      await active.request('thread/compact/start', { threadId: thread });
    } catch (error) {
      if (cancelled) return stopped();
      return fail(createTransportFailure(`Codex could not compact the thread: ${describeError(error)}`));
    }
    const ended = await Promise.race([compaction.promise, exit.promise]);
    closed = true;
    if (cancelled) return stopped();
    if (typeof ended === 'string') return fail(createTransportFailure(`${STREAM_ENDED} ${ended}`.trim()));
    if (ended.status !== 'completed') return fail(resolveCodexFailure(ended.error ?? turnError));
    return { outcome: 'completed', summary: null, undelivered: [] };
  };

  const start = async (): Promise<AgentSessionResult> => {
    const executable = await runtime.resolveExecutable();
    if (!executable.ok) return fail(createSetupFailure(executable.message, executable.reason));
    if (cancelled) return stopped();
    let active: CodexClient;
    try {
      endpoint = startToolEndpoint(input.tools, { heartbeatMs: options.heartbeatMs });
      active = new CodexClient({
        path: executable.path,
        cwd: input.cwd,
        env: runtime.env,
      });
      client = active;
      active.onNotification(observe);
      active.onRequest(answer);
      active.onExit((message) => exit.resolve(message));
      await active.initialize();
      threadId = await openThread(active, endpoint);
    } catch (error) {
      if (cancelled) return stopped();
      if (isMissingThread(error)) return fail(createLostSession(), false);
      return fail(createSetupFailure(`Codex could not start: ${describeError(error)}`));
    }
    input.onSession(threadId);
    return compacting ? runCompaction(active, threadId) : runTurns(active, threadId);
  };

  const release = () => {
    closed = true;
    recorder.closeAgents();
    client?.close();
    endpoint?.close();
  };

  const resolveSessionContext = () => {
    if (!context) return null;
    const lifetime = resolveCacheLifetimeMs(model);
    return {
      usedTokens: context.usedTokens,
      maxTokens: context.maxTokens,
      cacheExpiresAt: lastRequestAt === null ? null : lastRequestAt + lifetime,
      backgroundWork: false,
    };
  };

  const done = (async () => {
    try {
      return await start();
    } finally {
      release();
    }
  })().then((result) => {
    const usage = threadId ? meter.usage(threadId) : null;
    const subagents = meter.listOthers(threadId);
    const measured = resolveSessionContext();
    return {
      ...result,
      ...(usage ? { usage } : {}),
      ...(subagents.length > 0 ? { subagentUsage: subagents } : {}),
      ...(measured ? { context: measured } : {}),
    };
  });

  const steer = (text: string, from: 'you' | 'shinsa' = 'you') => {
    if (closed || cancelled || compacting) return false;
    input.onEntry({ type: 'user', from, text, attachments: [] });
    const prompt = { text, wire: from === 'you' ? resolveSteerPrompt(text) : text, steer: true };
    const active = turnId;
    if (!client || !threadId || !active) {
      queue.push(prompt);
      return true;
    }
    const steered = client
      .request('turn/steer', { threadId, expectedTurnId: active, input: textInput(prompt.wire) })
      .then(
        () => undefined,
        (error: unknown) => {
          log.info('[Codex] The turn could not be steered; the message goes in as the next turn', {
            error: describeError(error),
          });
          queue.push(prompt);
        }
      )
      .finally(() => steering.delete(steered));
    steering.add(steered);
    return true;
  };

  const cancel = async () => {
    cancelled = true;
    const active = turnId;
    if (client && threadId && active) {
      const interrupted = client.request('turn/interrupt', { threadId, turnId: active }).then(
        () => undefined,
        (error: unknown) => {
          log.warn('[Codex] Could not interrupt the turn', { error: describeError(error) });
        }
      );
      await Promise.race([interrupted, wait(timeoutMs)]);
    }
    client?.close();
    exit.resolve('cancelled');
  };

  return { done, steer, cancel };
}
