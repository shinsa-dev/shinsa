import {
  DomainError,
  listSlackStatusGates,
  type MachineCredentials,
  parseSlackEvaluation,
  parseSlackMention,
  resolveSlackConnectUrl,
  resolveSlackPostMessage,
  resolveSlackTaskUrl,
  type ShinsaEffect,
  SLACK_ENGINE_EVENTS_PATH,
  SLACK_EVALUATION_SCHEMA,
  SLACK_EVALUATION_SYSTEM,
  SLACK_FORWARD_HEADERS,
  type SlackEvaluation,
  type SlackMessage,
  type SlackSnapshot,
  type SlackThreadRef,
  serializeSlackEvaluationPrompt,
  serializeSlackReading,
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

const UNDECIDED: SlackEvaluation = {
  kind: 'none',
  reason: 'I could not read the thread just now, so I did not start anything. Mention me again in a minute.',
};

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

  #taskUrl(taskId: string | null) {
    const origin = this.#remote.appOrigin;
    return taskId ? resolveSlackTaskUrl(origin, taskId) : origin;
  }

  async #send(thread: SlackThreadRef, replaceTs: string | null, message: SlackMessage) {
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

  async evaluate(effect: Effect<'slack.evaluate'>, context: EffectContext) {
    const { mention } = effect;
    const statusTs = await this.#send(mention, null, serializeSlackReading());
    const said = await this.#ask<unknown>(
      SLACK_EVALUATION_SYSTEM,
      serializeSlackEvaluationPrompt(mention),
      SLACK_EVALUATION_SCHEMA
    );
    const evaluation = parseSlackEvaluation(said) ?? UNDECIDED;
    await this.#engine.dispatch(
      { type: 'slack.record_evaluation', mention, statusTs, evaluation },
      { id: `${context.key}:slack.record_evaluation` }
    );
  }

  async post(effect: Effect<'slack.post'>) {
    const message = resolveSlackPostMessage(
      this.#engine.state,
      effect.post,
      effect.taskId,
      this.#taskUrl(effect.taskId)
    );
    if (!message) return;
    await this.#send(effect.thread, effect.replaceTs, message);
  }

  async status(effect: Effect<'slack.status'>, context: EffectContext) {
    const last = this.#statusAt.get(effect.taskId);
    const wait = last === undefined ? 0 : last + this.#statusIntervalMs - this.#now();
    if (wait > 0) await this.#sleep(wait, context.signal);
    const state = this.#engine.state;
    const task = state.tasks[effect.taskId];
    const link = task?.slack;
    if (!task || !link) return;
    const message = serializeSlackStatus(task, listSlackStatusGates(state, task.id), this.#taskUrl(task.id));
    const shown = JSON.stringify(message);
    if (link.statusTs && this.#statusShown.get(task.id) === shown) return;
    const ts = await this.#send(link, link.statusTs, message);
    this.#statusAt.set(task.id, this.#now());
    if (!ts) return;
    this.#statusShown.set(task.id, shown);
    if (ts === link.statusTs) return;
    await this.#engine.dispatch(
      { type: 'slack.record_status', taskId: task.id, ts },
      { id: `${context.key}:slack.record_status` }
    );
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
