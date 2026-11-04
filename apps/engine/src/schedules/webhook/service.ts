import { createHash, randomBytes } from 'node:crypto';
import { SCHEDULE_LIMITS, type Schedule } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Ref } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import { SecretStore } from '../../secrets/index.ts';
import {
  FRAME_ID_BYTES,
  PROMPT_EMPTY,
  PROMPT_TOO_LONG,
  RATE_WINDOW_MS,
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_PATH,
  WEBHOOK_RATE_LIMIT_PER_MINUTE,
  WEBHOOK_ROUTE_PREFIX,
  type WebhookOutcome,
  type WebhookRequest,
} from '../schema.ts';
import { renderReplayKey, renderWebhookPrompt } from '../template.ts';
import { constantTimeEquals, verifyWebhookSignature } from '../verify.ts';
import { WebhookDeliveryFailed, WebhookDeliveryId } from './schema.ts';

export class WebhookReceiver extends Context.Service<
  WebhookReceiver,
  { readonly handle: (request: Request, url: URL) => Effect.Effect<Response> }
>()('shinsa/engine/schedules/webhook/WebhookReceiver') {
  static readonly layer = Layer.effect(
    WebhookReceiver,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const secrets = yield* SecretStore;
      const newId = yield* WebhookDeliveryId;
      const windows = yield* Ref.make<ReadonlyMap<string, readonly number[]>>(new Map());

      const respond = (status: number, outcome: WebhookOutcome, body: Record<string, string> = {}) =>
        Response.json(
          { outcome, ...body },
          { status, headers: { 'x-shinsa-hook-outcome': outcome, 'cache-control': 'no-store' } }
        );

      const readHeaders = (request: Request) => {
        const headers: Record<string, string> = {};
        request.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return headers;
      };

      const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

      const resolvePromptProblem = (prompt: string) => {
        const length = prompt.trim().length;
        if (length === 0) return PROMPT_EMPTY;
        return length > SCHEDULE_LIMITS.prompt ? PROMPT_TOO_LONG : null;
      };

      const decodeSegment = (segment: string | undefined) =>
        segment === undefined
          ? Effect.succeed(Option.none<string>())
          : Effect.option(Effect.try(() => decodeURIComponent(segment)));

      const readBody = Effect.fn('WebhookReceiver.readBody')(function* (request: Request) {
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (!Number.isFinite(declared) || declared > WEBHOOK_MAX_BODY_BYTES) return null;
        const buffer = yield* Effect.tryPromise({
          try: () => request.arrayBuffer(),
          catch: (error) => new WebhookDeliveryFailed({ message: String(error) }),
        });
        const body = new Uint8Array(buffer);
        return body.byteLength > WEBHOOK_MAX_BODY_BYTES ? null : body;
      });

      const takeSlot = Effect.fn('WebhookReceiver.takeSlot')(function* (scheduleId: string) {
        const now = yield* Clock.currentTimeMillis;
        return yield* Ref.modify(windows, (open) => {
          const recent = (open.get(scheduleId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
          const full = recent.length >= WEBHOOK_RATE_LIMIT_PER_MINUTE;
          return [!full, new Map(open).set(scheduleId, full ? recent : [...recent, now])];
        });
      });

      const selectHook = Effect.fn('WebhookReceiver.selectHook')(function* (path: string) {
        const match = WEBHOOK_PATH.exec(path);
        const scheduleId = yield* decodeSegment(match?.[1]);
        const token = yield* decodeSegment(match?.[2]);
        if (Option.isNone(scheduleId) || Option.isNone(token)) return null;
        const schedule = (yield* engine.state).schedules[scheduleId.value];
        const hook = yield* secrets.selectHook(scheduleId.value);
        if (schedule?.trigger.kind !== 'webhook' || !hook) return null;
        if (!constantTimeEquals(token.value, hook.token)) return null;
        return { schedule, secret: hook.secret };
      });

      const isSigned = (
        schedule: Schedule,
        secret: string | null,
        delivery: WebhookRequest,
        body: Uint8Array
      ) => {
        if (schedule.trigger.kind !== 'webhook' || !schedule.trigger.signature) return true;
        if (!secret) return false;
        return verifyWebhookSignature({
          signature: schedule.trigger.signature,
          secret,
          headers: delivery.headers,
          body,
        });
      };

      const deliver = Effect.fn('WebhookReceiver.deliver')(function* (
        schedule: Schedule,
        delivery: WebhookRequest
      ) {
        const deliveryId = yield* newId;
        const template = schedule.trigger.kind === 'webhook' ? schedule.trigger.replayKey : null;
        const rendered = template ? renderReplayKey(template, delivery) : null;
        const replayKey = rendered === null ? null : hashKey(rendered);
        if (replayKey !== null && (schedule.replayKeys[replayKey] ?? 0) > (yield* Clock.currentTimeMillis)) {
          return respond(202, 'duplicate', { deliveryId });
        }
        const prompt = renderWebhookPrompt(
          schedule.text,
          delivery,
          randomBytes(FRAME_ID_BYTES).toString('hex')
        );
        const id = `webhook:${schedule.id}:${deliveryId}`;
        const problem = resolvePromptProblem(prompt);
        if (problem) {
          yield* engine.dispatch(
            { type: 'schedule.fail', scheduleId: schedule.id, dueAt: null, deliveryId, detail: problem },
            { id: `${id}:fail` }
          );
          return respond(202, 'prompt_refused', { deliveryId, error: problem });
        }
        const events = yield* engine.dispatch(
          { type: 'schedule.deliver', scheduleId: schedule.id, deliveryId, text: prompt, replayKey },
          { id }
        );
        return respond(
          202,
          events.some((event) => event.type === 'schedule.fired') ? 'accepted' : 'duplicate',
          {
            deliveryId,
          }
        );
      });

      const receive = Effect.fn('WebhookReceiver.receive')(function* (
        request: Request,
        url: URL,
        schedule: Schedule,
        secret: string | null
      ) {
        const body = yield* readBody(request);
        if (!body) return respond(413, 'body_too_large', { error: 'The body is larger than 1 MB.' });
        const delivery: WebhookRequest = {
          method: request.method,
          path: `${WEBHOOK_ROUTE_PREFIX}/${schedule.id}`,
          query: url.search.slice(1),
          headers: readHeaders(request),
          bodyText: new TextDecoder().decode(body),
        };
        if (!isSigned(schedule, secret, delivery, body)) {
          return respond(401, 'rejected_signature', { error: 'The signature does not match.' });
        }
        return yield* deliver(schedule, delivery);
      });

      const handle = Effect.fn('WebhookReceiver.handle')(function* (request: Request, url: URL) {
        const found = yield* selectHook(url.pathname);
        if (!found) return respond(404, 'not_found', { error: 'No webhook here.' });
        const { schedule, secret } = found;
        if (!(yield* takeSlot(schedule.id))) {
          return respond(429, 'rate_limited', { error: 'Too many requests. Try again in a minute.' });
        }
        if (!schedule.enabled)
          return respond(409, 'disabled', { error: 'This schedule is paused or finished.' });
        return yield* receive(request, url, schedule, secret).pipe(
          Effect.catch((failure) =>
            Effect.logWarning('[Webhooks] A delivery could not be recorded').pipe(
              Effect.annotateLogs({ scheduleId: schedule.id, error: failure.message }),
              Effect.as(respond(500, 'error', { error: 'Shinsa could not take the request.' }))
            )
          )
        );
      });

      return WebhookReceiver.of({ handle });
    })
  );
}
