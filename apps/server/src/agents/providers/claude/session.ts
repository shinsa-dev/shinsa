import type {
  McpSdkServerConfigWithInstance,
  McpServerConfig,
  Query,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import {
  type ChatNotice,
  isReadOnlyRole,
  type RunFailure,
  type RunUsage,
  resolveSteerPrompt,
} from '@shinsa/core';
import { resolveAccountEnv } from '../../../accounts/paths.ts';
import { describeError, log } from '../../../log/index.ts';
import type { ShinsaTools } from '../../tools/index.ts';
import { SHINSA_INSTRUCTIONS } from '../instructions.ts';
import type { AgentSession, AgentSessionInput, AgentSessionResult } from '../types.ts';
import { AsyncQueue } from './async-queue.ts';
import {
  createSetupFailure,
  createTransportFailure,
  createTurnEvidence,
  recordAssistantError,
  recordRateLimit,
  resolveClaudeVerdict,
  type TurnVerdict,
} from './classify.ts';
import { listBackgroundWork, resolveCacheExpiry } from './context.ts';
import { resolveClaudeExtensions, serializeClaudeServer } from './extensions.ts';
import { guardCommand } from './guard.ts';
import { type ClaudeRecorder, createClaudeRecorder, resolveUsageSnapshot } from './recorder.ts';
import { type EunoeLink, resolveClaudeRoute } from './route.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime, resolveClaudeProcess } from './sdk.ts';
import { resolveClaudeUsage } from './usage.ts';

export interface ClaudeSessionOptions {
  runtime?: ClaudeRuntime;
  eunoe?: EunoeLink | null;
  foldedTurnMs?: number;
  contextTimeoutMs?: number;
  now?: () => number;
}

interface PendingPrompt {
  id: string;
  text: string;
  steer: boolean;
}

const FOLDED_TURN_MS = 60_000;

const CONTEXT_TIMEOUT_MS = 5_000;

const SUMMARY_LIMIT = 2000;

const STREAM_ENDED = 'The agent’s process ended before it finished its turn.';

function serializeToolServer(tools: ShinsaTools): McpSdkServerConfigWithInstance {
  return {
    type: 'sdk',
    name: tools.name,
    instance: tools.server as unknown as McpSdkServerConfigWithInstance['instance'],
  };
}

function createUserMessage(text: string, id: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
    uuid: id as SDKUserMessage['uuid'],
  };
}

function listEchoedPromptIds(message: SDKResultMessage) {
  const ids = Array.isArray(message.user_message_uuids)
    ? message.user_message_uuids.filter((id) => typeof id === 'string')
    : [];
  if (ids.length > 0) return ids;
  return typeof message.user_message_uuid === 'string' && message.user_message_uuid
    ? [message.user_message_uuid]
    : [];
}

function isOtherOrigin(message: SDKResultMessage) {
  return message.origin !== undefined && message.origin.kind !== 'human';
}

class PromptLedger {
  pending: PendingPrompt[] = [];
  echoes: boolean;

  constructor(echoes: boolean) {
    this.echoes = echoes;
  }

  add(prompt: PendingPrompt) {
    this.pending.push(prompt);
  }

  take(ids: string[], endedEarly: boolean) {
    if (ids.length > 0) {
      this.echoes = true;
      const answered = this.pending.filter((prompt) => ids.includes(prompt.id));
      this.pending = this.pending.filter((prompt) => !ids.includes(prompt.id));
      return answered;
    }
    const head = this.pending[0];
    if (!head || (this.echoes && !endedEarly)) return [];
    this.pending.shift();
    return [head];
  }

  listUndelivered() {
    return this.pending.filter((prompt) => prompt.steer).map((prompt) => prompt.text);
  }
}

async function requestContextUsage(session: Query, timeoutMs: number) {
  if (typeof session.getContextUsage !== 'function') return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const usage = await Promise.race([session.getContextUsage(), timeout]);
    if (!usage || usage.totalTokens <= 0) return null;
    return { usedTokens: usage.totalTokens, maxTokens: usage.maxTokens > 0 ? usage.maxTokens : null };
  } catch (error) {
    log.warn('[Claude] Could not read the context usage', { error: describeError(error) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function recordContext(
  recorder: ClaudeRecorder,
  session: Query,
  message: SDKResultMessage,
  timeoutMs: number
) {
  const fallback = recorder.takeUsage();
  const measured = await requestContextUsage(session, timeoutMs);
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
  return { usedTokens: usage.usedTokens, maxTokens };
}

async function recordAccount(recorder: ClaudeRecorder, session: Query) {
  if (typeof session.accountInfo !== 'function') return;
  try {
    const account = await session.accountInfo();
    recorder.notify({
      kind: 'account',
      email: account.email ?? null,
      organization: account.organization ?? null,
      plan: account.subscriptionType ?? null,
    });
  } catch (error) {
    log.warn('[Claude] Could not read the account', { error: describeError(error) });
  }
}

function resolveFastModeNotice(message: SDKSystemMessage): ChatNotice | null {
  const state = message.fast_mode_state;
  if (state === undefined || state === 'on') return null;
  return {
    kind: 'fast_mode',
    status: state === 'cooldown' ? 'cooldown' : 'unavailable',
    reason: message.fast_mode_disabled_reason ?? null,
  };
}

function resolveSummary(message: SDKResultMessage, verdict: TurnVerdict) {
  if (verdict.failure) return verdict.failure.message;
  return message.subtype === 'success' ? message.result.slice(0, SUMMARY_LIMIT) : null;
}

function removeServers(connected: Record<string, McpServerConfig>, names: string[]) {
  for (const name of names) delete connected[name];
}

export function startClaudeSession(
  input: AgentSessionInput,
  options: ClaudeSessionOptions = {}
): AgentSession {
  const runtime = options.runtime ?? CLAUDE_RUNTIME;
  const now = options.now ?? Date.now;
  const prompts = new AsyncQueue<SDKUserMessage>();
  const ledger = new PromptLedger(false);
  const recorder = createClaudeRecorder(input.onEntry, input.storeImage);
  let session: Query | null = null;
  let cancelled = false;
  let closed = false;
  let folded: ReturnType<typeof setTimeout> | null = null;
  let eunoe = false;
  let unwatch: (() => void) | null = null;

  const close = () => {
    closed = true;
    if (folded) clearTimeout(folded);
    prompts.close();
  };
  const closeFolded = () => {
    ledger.pending = [];
    close();
  };
  const send = (text: string, wire: string, steer: boolean) => {
    const id = crypto.randomUUID();
    ledger.add({ id, text, steer });
    prompts.push(createUserMessage(wire, id));
  };

  send(input.prompt, input.prompt, false);
  input.onEntry({ type: 'user', from: 'shinsa', text: input.prompt, attachments: [] });
  if (input.extensions) recorder.notify({ kind: 'extensions', ...input.extensions.loaded });

  const extensions = resolveClaudeExtensions(input.extensions);
  const hasServers = Object.keys(extensions.servers).length > 0;
  const released = Promise.withResolvers<void>();
  const gated = async function* () {
    await released.promise;
    yield* prompts;
  };
  const appended = [SHINSA_INSTRUCTIONS, extensions.instructions].filter(Boolean).join('\n\n');

  const start = async () => {
    const process = await resolveClaudeProcess(runtime.resolveExecutable);
    ledger.echoes = process.version !== null;
    const configDir = input.account?.configDir ?? null;
    const route = await resolveClaudeRoute(input.compaction ?? 'claude', options.eunoe ?? null, configDir);
    if (route.notice) recorder.notify(route.notice);
    eunoe = route.eunoe;
    return runtime.runQuery({
      prompt: hasServers ? gated() : prompts,
      options: {
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.resume ? { resume: input.resume } : {}),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        mcpServers: { [input.tools.name]: serializeToolServer(input.tools) },
        disallowedTools: isReadOnlyRole(input.role) ? ['Edit', 'Write', 'NotebookEdit'] : [],
        strictMcpConfig: true,
        skills: extensions.skills,
        settingSources: ['user', 'project', 'local'],
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: appended,
        },
        plugins: [{ type: 'local', path: input.pluginDir }],
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [guardCommand(input.defaultBranch)] }],
        },
        forwardSubagentText: true,
        settings: {
          ...(Object.keys(extensions.enabledPlugins).length > 0
            ? { enabledPlugins: extensions.enabledPlugins }
            : {}),
          ...(Object.keys(extensions.skillOverrides).length > 0
            ? { skillOverrides: extensions.skillOverrides }
            : {}),
          fastMode: input.fastMode === true,
          autoCompactEnabled: route.autoCompact,
          env: route.env,
        },
        ...process.options,
        env: { ...process.options.env, ...resolveAccountEnv(configDir), ...route.env },
      },
    });
  };

  let evidence = createTurnEvidence();
  let verdict: TurnVerdict | null = null;
  let summary: string | null = null;
  let usage: RunUsage | null = null;
  let contextTokens: number | null = null;
  let contextWindow: number | null = null;
  let cacheExpiresAt: number | null = null;
  let background = new Set<string>();

  const recordInit = (message: SDKSystemMessage) => {
    input.onSession(message.session_id);
    const fast = input.fastMode ? resolveFastModeNotice(message) : null;
    if (fast) recorder.notify(fast);
    if (!eunoe || !options.eunoe) return;
    unwatch?.();
    unwatch = options.eunoe.watch(message.session_id, recorder.notify);
  };

  const observe = (message: SDKMessage) => {
    input.onActivity?.();
    if (message.type === 'system' && message.subtype === 'init') recordInit(message);
    if (message.type === 'system' && message.subtype === 'background_tasks_changed') {
      background = listBackgroundWork(message.tasks);
    }
    if (message.type === 'assistant') recordAssistantError(evidence, message);
    if (message.type === 'rate_limit_event') recordRateLimit(evidence, message.rate_limit_info);
    recorder.record(message);
    if (!folded) return;
    clearTimeout(folded);
    folded = null;
  };

  const answer = (message: SDKResultMessage, next: TurnVerdict) => {
    const ids = listEchoedPromptIds(message);
    if (ids.length === 0 && ledger.echoes && isOtherOrigin(message)) return [];
    return ledger.take(ids, next.status !== 'completed');
  };

  const settle = async (active: Query, message: SDKResultMessage) => {
    usage = resolveClaudeUsage(message) ?? usage;
    const next = resolveClaudeVerdict(message, evidence, now());
    const answered = answer(message, next);
    if (answered.length === 0) return;
    evidence = createTurnEvidence();
    const steered = answered.length === 1 && ledger.pending.some((prompt) => prompt.steer);
    if (next.status === 'interrupted' && !cancelled && steered) return;
    cacheExpiresAt = resolveCacheExpiry(message.usage, now());
    const measured = await recordContext(
      recorder,
      active,
      message,
      options.contextTimeoutMs ?? CONTEXT_TIMEOUT_MS
    );
    contextTokens = measured?.usedTokens ?? contextTokens;
    contextWindow = measured?.maxTokens ?? contextWindow;
    if (next.status === 'interrupted') recorder.notify({ kind: 'interrupted' });
    verdict = next;
    summary = resolveSummary(message, next);
    if (ledger.pending.length === 0) close();
    else if (!ledger.echoes) {
      folded = setTimeout(closeFolded, options.foldedTurnMs ?? FOLDED_TURN_MS);
      folded.unref();
    }
  };

  const crash = (error: unknown): AgentSessionResult => {
    close();
    recorder.flush('interim');
    const undelivered = ledger.listUndelivered();
    if (cancelled) return { outcome: 'cancelled', summary: null, undelivered };
    const text = describeError(error);
    input.onEntry({ type: 'error', text });
    return { outcome: 'failed', summary: text, failure: createTransportFailure(text), undelivered };
  };

  const finish = (): AgentSessionResult => {
    recorder.flush('interim');
    const undelivered = ledger.listUndelivered();
    if (cancelled) return { outcome: 'cancelled', summary, undelivered };
    if (!verdict) {
      input.onEntry({ type: 'error', text: STREAM_ENDED });
      return {
        outcome: 'failed',
        summary: STREAM_ENDED,
        failure: createTransportFailure(STREAM_ENDED),
        undelivered,
      };
    }
    const failure: RunFailure | null = verdict.failure;
    return {
      outcome: verdict.status === 'completed' ? 'completed' : 'failed',
      summary,
      failure,
      undelivered,
    };
  };

  const consume = async (active: Query): Promise<AgentSessionResult> => {
    try {
      for await (const message of active as AsyncIterable<SDKMessage>) {
        observe(message);
        if (message.type === 'result') await settle(active, message);
      }
    } catch (error) {
      return crash(error);
    }
    return finish();
  };

  const connected: Record<string, McpServerConfig> = {
    [input.tools.name]: serializeToolServer(input.tools),
    ...extensions.servers,
  };

  const connectServers = async (active: Query) => {
    try {
      const result = await active.setMcpServers(connected);
      for (const [name, error] of Object.entries(result.errors)) {
        log.warn('[Claude] An MCP server did not connect', { server: name, error });
      }
    } catch (error) {
      log.warn('[Claude] Could not hand the MCP servers to the session', { error: describeError(error) });
    } finally {
      released.resolve();
    }
  };

  const done = (async (): Promise<AgentSessionResult> => {
    try {
      session = await start();
    } catch (error) {
      const text = describeError(error);
      input.onEntry({ type: 'error', text });
      return { outcome: 'failed', summary: text, failure: createSetupFailure(text) };
    }
    if (cancelled) {
      session.close();
      return { outcome: 'cancelled', summary: null, undelivered: ledger.listUndelivered() };
    }
    if (hasServers) await connectServers(session);
    void recordAccount(recorder, session);
    const result = await consume(session).finally(() => unwatch?.());
    const withUsage = usage ? { ...result, usage } : result;
    if (contextTokens === null && cacheExpiresAt === null && background.size === 0) return withUsage;
    return {
      ...withUsage,
      context: {
        usedTokens: contextTokens,
        maxTokens: contextWindow,
        cacheExpiresAt,
        backgroundWork: background.size > 0,
      },
    };
  })();

  return {
    done,
    hasPendingBackgroundWork: () => background.size > 0,
    loadMcpServers: async (servers, abandoned) => {
      const active = session;
      if (!active || closed) throw new Error('The session has ended.');
      for (const server of servers) connected[server.claudeName] = serializeClaudeServer(server.definition);
      try {
        const result = await active.setMcpServers(connected);
        const errors = Object.fromEntries(
          servers.map((server) => [server.claudeName, result.errors[server.claudeName] ?? null])
        );
        const failed = Object.keys(errors).filter((name) => abandoned.aborted || errors[name] !== null);
        removeServers(connected, failed);
        return errors;
      } catch (error) {
        removeServers(
          connected,
          servers.map((server) => server.claudeName)
        );
        throw error;
      }
    },
    steer: (text, from = 'you') => {
      if (closed || cancelled) return false;
      input.onEntry({ type: 'user', from, text, attachments: [] });
      send(text, from === 'you' ? resolveSteerPrompt(text) : text, true);
      return true;
    },
    cancel: async () => {
      cancelled = true;
      close();
      const active = session;
      if (!active) return;
      try {
        await active.interrupt();
      } catch {
        active.close();
      }
    },
  };
}
