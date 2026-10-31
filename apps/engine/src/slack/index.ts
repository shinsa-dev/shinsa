import {
  DomainError,
  isSlackPreviewRequest,
  listSlackPreviewPosts,
  listSlackStatusGates,
  type MachineCredentials,
  parseSlackEvaluation,
  parseSlackMention,
  resolveSlackConnectUrl,
  resolveSlackPostMessage,
  resolveSlackReaction,
  resolveSlackSessionStatus,
  resolveSlackTaskUrl,
  resolveSlackThreadKey,
  type ShinsaEffect,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_EVALUATION_SCHEMA,
  SLACK_EVALUATION_SYSTEM,
  SLACK_FORWARD_HEADERS,
  SLACK_PREVIEW_REACTIONS,
  SLACK_REACTIONS,
  type SlackMention,
  type SlackMessage,
  type SlackSessionStatus,
  type SlackSnapshot,
  type SlackThreadRef,
  serializeSlackDeclined,
  serializeSlackEvaluationPrompt,
  serializeSlackPreviewIntro,
  serializeSlackStatus,
  verifySlackForwardSignature,
} from '@shinsa/core';
import type { QuickJson } from '../agents/quick/index.ts';
import type { ApiRoute } from '../http/routes.ts';
import { describeError, log } from '../log/index.ts';
import type { Remote } from '../remote/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { type Fetch, SlackRelay, SlackRelayError } from './relay.ts';

export { SlackRelay, SlackRelayError } from './relay.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

const STATUS_INTERVAL_MS = 5_000;

type Effect<Kind extends ShinsaEffect['kind']> = Extract<ShinsaEffect, { kind: Kind }>;

type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export interface SlackOptions {
  engine: Engine;
  remote: Remote;
  ask: QuickJson;
  fetch?: Fetch;
  now?: () => number;
  sleep?: Sleep;
  statusIntervalMs?: number;
}

function sleepFor(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

function respondJsonError(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export class Slack {
  readonly #engine: Engine;
  readonly #remote: Remote;
  readonly #ask: QuickJson;
  readonly #relay: SlackRelay;
  readonly #now: () => number;
  readonly #sleep: Sleep;
  readonly #statusIntervalMs: number;
  readonly #statusAt = new Map<string, number>();
  readonly #statusShown = new Map<string, string>();
  readonly #sessionShown = new Map<string, SlackSessionStatus>();
  readonly #declined = new Set<string>();

  constructor(options: SlackOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#ask = options.ask;
    this.#relay = new SlackRelay(() => options.remote.appOrigin, options.fetch);
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? sleepFor;
    this.#statusIntervalMs = options.statusIntervalMs ?? STATUS_INTERVAL_MS;
  }

  #selectCredentials(): MachineCredentials | null {
    return this.#remote.isEnabled ? this.#remote.store.file.credentials : null;
  }

  isEventsPath(pathname: string) {
    return pathname === SLACK_ENGINE_EVENTS_PATH;
  }

  async handleEvents(request: Request) {
    const credentials = this.#selectCredentials();
    if (!credentials) return respondJsonError('not_found', 'No such endpoint.', 404);
    const body = await request.text();
    if (body.length > SLACK_EVENT_BODY_LIMIT_BYTES)
      return respondJsonError('body_too_large', 'The mention is over 1 MB.', 413);
    const signed = await verifySlackForwardSignature(
      credentials.connectKey,
      {
        signature: request.headers.get(SLACK_FORWARD_HEADERS.signature),
        timestamp: request.headers.get(SLACK_FORWARD_HEADERS.timestamp),
      },
      body,
      this.#now()
    );
    if (!signed) return respondJsonError('unauthorized', 'The mention is not signed by app.shinsa.dev.', 401);
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return respondJsonError('body_invalid', 'The mention is not JSON.', 400);
    }
    const mention = parseSlackMention(value);
    if (!mention) return respondJsonError('body_invalid', 'The mention is missing a part.', 400);
    await this.#engine.dispatch({ type: 'slack.mention', mention }, { id: `slack:${mention.eventId}` });
    return Response.json({ ok: true }, { status: 202 });
  }

  #taskUrl(taskId: string) {
    return resolveSlackTaskUrl(this.#remote.appOrigin, taskId);
  }

  async #send(
    thread: SlackThreadRef,
    replaceTs: string | null,
    message: SlackMessage
  ): Promise<string | null> {
    const credentials = this.#selectCredentials();
    if (!credentials) {
      log.warn('[Slack] Remote access is off, so nothing was posted', { threadTs: thread.threadTs });
      return null;
    }
    try {
      return await this.#relay.requestPost(credentials.machineToken, {
        teamId: thread.teamId,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        replaceTs,
        message,
      });
    } catch (error) {
      if (error instanceof SlackRelayError && !error.isRetryable) {
        log.warn('[Slack] app.shinsa.dev refused the post', {
          code: error.code,
          threadTs: thread.threadTs,
          error: describeError(error),
        });
        return null;
      }
      throw error;
    }
  }

  async #react(thread: SlackThreadRef, messageTs: string, add: string | null, remove: string | null) {
    const credentials = this.#selectCredentials();
    if (!credentials || add === remove) return;
    try {
      const applied = await this.#relay.requestReaction(credentials.machineToken, {
        teamId: thread.teamId,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        messageTs,
        add,
        remove,
      });
      if (!applied) log.info('[Slack] Slack did not take the reaction', { messageTs, add });
    } catch (error) {
      log.warn('[Slack] The reaction could not be set', { messageTs, add, error: describeError(error) });
    }
  }

  async #preview(mention: SlackMention) {
    const credentials = this.#selectCredentials();
    const origin = this.#remote.appOrigin;
    const connectUrl = credentials ? resolveSlackConnectUrl(origin, credentials.instanceId) : origin;
    const posts = listSlackPreviewPosts(origin, connectUrl);
    await this.#send(mention, null, serializeSlackPreviewIntro(posts));
    for (const post of posts) await this.#send(mention, null, post.message);
    let shown: string | null = null;
    for (const reaction of SLACK_PREVIEW_REACTIONS) {
      await this.#react(mention, mention.messageTs, reaction, shown);
      shown = reaction;
    }
  }

  async evaluate(effect: Effect<'slack.evaluate'>, context: EffectContext) {
    const { mention } = effect;
    if (isSlackPreviewRequest(mention.text)) {
      await this.#preview(mention);
      return;
    }
    await this.#react(mention, mention.messageTs, SLACK_REACTIONS.sizing, null);
    const said = await this.#ask<unknown>(
      SLACK_EVALUATION_SYSTEM,
      serializeSlackEvaluationPrompt(mention),
      SLACK_EVALUATION_SCHEMA
    );
    if (parseSlackEvaluation(said) === 'none') {
      await this.#react(mention, mention.messageTs, null, SLACK_REACTIONS.sizing);
      const key = resolveSlackThreadKey(mention);
      if (this.#declined.has(key)) return;
      this.#declined.add(key);
      await this.#send(mention, null, serializeSlackDeclined());
      return;
    }
    await this.#engine.dispatch(
      { type: 'slack.start_task', mention },
      { id: `${context.key}:slack.start_task` }
    );
  }

  async post(effect: Effect<'slack.post'>) {
    const url = this.#taskUrl(effect.taskId);
    const message = resolveSlackPostMessage(this.#engine.state, effect.post, effect.taskId, url);
    if (!message) return;
    await this.#send(effect.thread, null, message);
  }

  async status(effect: Effect<'slack.status'>, context: EffectContext) {
    const last = this.#statusAt.get(effect.taskId);
    const wait = last === undefined ? 0 : last + this.#statusIntervalMs - this.#now();
    if (wait > 0) await this.#sleep(wait, context.signal);
    const state = this.#engine.state;
    const task = state.tasks[effect.taskId];
    const link = task?.slack;
    if (!task || !link) return;
    const gates = listSlackStatusGates(state, task.id);
    const message = serializeSlackStatus(task, gates, this.#taskUrl(task.id));
    const shown = JSON.stringify(message);
    const reaction = resolveSlackReaction(task, gates);
    if (link.statusTs && this.#statusShown.get(task.id) === shown && reaction === link.reaction) return;
    let ts = await this.#send(link, link.statusTs, message);
    if (!ts && link.statusTs) ts = await this.#send(link, null, message);
    this.#statusAt.set(task.id, this.#now());
    if (!ts) return;
    this.#statusShown.set(task.id, shown);
    await this.#syncSession(link, task.id, resolveSlackSessionStatus(task, gates));
    await this.#react(link, link.messageTs, reaction, link.reaction);
    if (ts === link.statusTs && reaction === link.reaction) return;
    await this.#engine.dispatch(
      { type: 'slack.record_status', taskId: task.id, ts, reaction },
      { id: `${context.key}:slack.record_status` }
    );
  }

  async #syncSession(thread: SlackThreadRef, taskId: string, status: SlackSessionStatus) {
    const credentials = this.#selectCredentials();
    if (!credentials || this.#sessionShown.get(taskId) === status) return;
    try {
      const applied = await this.#relay.requestSession(credentials.machineToken, {
        teamId: thread.teamId,
        channelId: thread.channelId,
        threadTs: thread.threadTs,
        status,
      });
      this.#sessionShown.set(taskId, status);
      if (!applied) log.info('[Slack] Slack did not show the thread status', { taskId, status });
    } catch (error) {
      log.warn('[Slack] The thread status could not be set', { taskId, status, error: describeError(error) });
    }
  }

  async snapshot(): Promise<SlackSnapshot> {
    const credentials = this.#selectCredentials();
    if (!credentials) return { remote: false, connectUrl: null, links: [], problem: null };
    const connectUrl = resolveSlackConnectUrl(this.#remote.appOrigin, credentials.instanceId);
    try {
      const links = await this.#relay.requestLinks(credentials.machineToken);
      return { remote: true, connectUrl, links, problem: null };
    } catch (error) {
      log.warn('[Slack] Could not read the Slack links', { error: describeError(error) });
      return {
        remote: true,
        connectUrl,
        links: [],
        problem:
          'app.shinsa.dev could not be reached, so Shinsa cannot say which Slack accounts are connected.',
      };
    }
  }

  async disconnect() {
    const credentials = this.#selectCredentials();
    if (!credentials) throw new DomainError('remote_not_paired', 'Turn on remote access first.');
    await this.#relay.requestUnlink(credentials.machineToken);
    return this.snapshot();
  }

  routes(): ApiRoute[] {
    return [
      {
        method: 'GET',
        pattern: /^\/api\/slack$/,
        respond: async () => Response.json(await this.snapshot()),
      },
      {
        method: 'POST',
        pattern: /^\/api\/slack\/disconnect$/,
        respond: async () => Response.json(await this.disconnect()),
      },
    ];
  }
}
