import { randomBytes } from 'node:crypto';
import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Engine } from '../runtime/engine.ts';
import type { SecretStore } from '../secrets/index.ts';
import { FRAME_ID_BYTES, WEBHOOK_ROUTE_PREFIX, type WebhookReceiverOptions } from './schema.ts';
import { WebhookDeliveryFailed, type WebhookHandle } from './webhook/schema.ts';
import { makeWebhookReceiver } from './webhook/service.ts';

export {
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_RATE_LIMIT_PER_MINUTE,
  type WebhookReceiverOptions,
} from './schema.ts';

export function isWebhookPath(pathname: string) {
  return pathname.startsWith(`${WEBHOOK_ROUTE_PREFIX}/`);
}

export class WebhookReceiver {
  readonly #handle: WebhookHandle;

  constructor(engine: Engine, secrets: SecretStore, options: WebhookReceiverOptions = {}) {
    const newId = options.newId ?? (() => Bun.randomUUIDv7());
    this.#handle = edgeRuntime.runSync(
      makeWebhookReceiver({
        state: Effect.sync(() => engine.state),
        selectHook: (scheduleId) => Effect.sync(() => secrets.selectHook(scheduleId)),
        now: Effect.sync(options.now ?? Date.now),
        newId: Effect.sync(newId),
        frameId: Effect.sync(() => randomBytes(FRAME_ID_BYTES).toString('hex')),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) => new WebhookDeliveryFailed({ message: describeError(error) }),
          }),
      })
    );
  }

  handle(request: Request, url: URL) {
    return edgeRuntime.runPromise(this.#handle.handle(request, url));
  }
}
