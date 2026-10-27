import { createHash, randomBytes } from 'node:crypto';
import { SCHEDULE_LIMITS, type Schedule } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { SecretStore } from '../secrets/index.ts';
import { renderReplayKey, renderWebhookPrompt, type WebhookRequest } from './template.ts';
import { constantTimeEquals, verifyWebhookSignature } from './verify.ts';

export const WEBHOOK_ROUTE_PREFIX = '/api/hooks';

export const WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

export const WEBHOOK_RATE_LIMIT_PER_MINUTE = 60;

const MINUTE = 60_000;

const ROUTE = /^\/api\/hooks\/([^/]+)\/([^/]+)$/;

const PROMPT_TOO_LONG = 'The filled-in prompt is too long.';

const PROMPT_EMPTY = 'The filled-in prompt is empty.';

type WebhookOutcome =
  | 'accepted'
  | 'duplicate'
  | 'prompt_refused'
  | 'not_found'
  | 'disabled'
  | 'rejected_signature'
  | 'rate_limited'
  | 'body_too_large'
  | 'error';

export interface WebhookReceiverOptions {
  now?: () => number;
  newId?: () => string;
}

function respond(status: number, outcome: WebhookOutcome, body: Record<string, string> = {}) {
  return Response.json(
    { outcome, ...body },
    { status, headers: { 'x-shinsa-hook-outcome': outcome, 'cache-control': 'no-store' } }
  );
}

async function readBody(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > WEBHOOK_MAX_BODY_BYTES) return null;
  const body = new Uint8Array(await request.arrayBuffer());
  return body.byteLength > WEBHOOK_MAX_BODY_BYTES ? null : body;
}

function readHeaders(request: Request) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value;
  });
  return headers;
}

function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

function resolvePromptProblem(prompt: string) {
  const length = prompt.trim().length;
  if (length === 0) return PROMPT_EMPTY;
  return length > SCHEDULE_LIMITS.prompt ? PROMPT_TOO_LONG : null;
}

function decodeSegment(segment: string | undefined) {
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function isWebhookPath(pathname: string) {
  return pathname.startsWith(`${WEBHOOK_ROUTE_PREFIX}/`);
}

export class WebhookReceiver {
  readonly #engine: Engine;
  readonly #secrets: SecretStore;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #windows = new Map<string, number[]>();

  constructor(engine: Engine, secrets: SecretStore, options: WebhookReceiverOptions = {}) {
    this.#engine = engine;
    this.#secrets = secrets;
    this.#now = options.now ?? Date.now;
    this.#newId = options.newId ?? (() => Bun.randomUUIDv7());
  }

  #takeSlot(scheduleId: string) {
    const now = this.#now();
    const recent = (this.#windows.get(scheduleId) ?? []).filter((at) => now - at < MINUTE);
    if (recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE) {
      this.#windows.set(scheduleId, recent);
      return false;
    }
    this.#windows.set(scheduleId, [...recent, now]);
    return true;
  }

  #selectHook(path: string) {
    const match = ROUTE.exec(path);
    const scheduleId = decodeSegment(match?.[1]);
    const token = decodeSegment(match?.[2]);
    if (scheduleId === null || token === null) return null;
    const schedule = this.#engine.state.schedules[scheduleId];
    const hook = this.#secrets.selectHook(scheduleId);
    if (schedule?.trigger.kind !== 'webhook' || !hook) return null;
    if (!constantTimeEquals(token, hook.token)) return null;
    return { schedule, secret: hook.secret };
  }

  async handle(request: Request, url: URL): Promise<Response> {
    const found = this.#selectHook(url.pathname);
    if (!found) return respond(404, 'not_found', { error: 'No webhook here.' });
    const { schedule, secret } = found;
    if (!this.#takeSlot(schedule.id)) {
      return respond(429, 'rate_limited', { error: 'Too many requests. Try again in a minute.' });
    }
    if (!schedule.enabled) return respond(409, 'disabled', { error: 'This schedule is paused or finished.' });
    try {
      return await this.#receive(request, url, schedule, secret);
    } catch (error) {
      log.warn('[Webhooks] A delivery could not be recorded', {
        scheduleId: schedule.id,
        error: describeError(error),
      });
      return respond(500, 'error', { error: 'Shinsa could not take the request.' });
    }
  }

  async #receive(request: Request, url: URL, schedule: Schedule, secret: string | null) {
    const body = await readBody(request);
    if (!body) return respond(413, 'body_too_large', { error: 'The body is larger than 1 MB.' });
    const delivery: WebhookRequest = {
      method: request.method,
      path: `${WEBHOOK_ROUTE_PREFIX}/${schedule.id}`,
      query: url.search.slice(1),
      headers: readHeaders(request),
      bodyText: new TextDecoder().decode(body),
    };
    if (!this.#isSigned(schedule, secret, delivery, body)) {
      return respond(401, 'rejected_signature', { error: 'The signature does not match.' });
    }
    return this.#deliver(schedule, delivery);
  }

  #isSigned(schedule: Schedule, secret: string | null, delivery: WebhookRequest, body: Uint8Array) {
    if (schedule.trigger.kind !== 'webhook' || !schedule.trigger.signature) return true;
    if (!secret) return false;
    return verifyWebhookSignature({
      signature: schedule.trigger.signature,
      secret,
      headers: delivery.headers,
      body,
    });
  }

  async #deliver(schedule: Schedule, delivery: WebhookRequest) {
    const deliveryId = this.#newId();
    const template = schedule.trigger.kind === 'webhook' ? schedule.trigger.replayKey : null;
    const rendered = template ? renderReplayKey(template, delivery) : null;
    const replayKey = rendered === null ? null : hashKey(rendered);
    if (replayKey !== null && (schedule.replayKeys[replayKey] ?? 0) > this.#now()) {
      return respond(202, 'duplicate', { deliveryId });
    }
    const prompt = renderWebhookPrompt(schedule.text, delivery, randomBytes(6).toString('hex'));
    const id = `webhook:${schedule.id}:${deliveryId}`;
    const problem = resolvePromptProblem(prompt);
    if (problem) {
      await this.#engine.dispatch(
        { type: 'schedule.fail', scheduleId: schedule.id, dueAt: null, deliveryId, detail: problem },
        { id: `${id}:fail` }
      );
      return respond(202, 'prompt_refused', { deliveryId, error: problem });
    }
    const events = await this.#engine.dispatch(
      { type: 'schedule.deliver', scheduleId: schedule.id, deliveryId, text: prompt, replayKey },
      { id }
    );
    return respond(202, events.some((event) => event.type === 'schedule.fired') ? 'accepted' : 'duplicate', {
      deliveryId,
    });
  }
}
