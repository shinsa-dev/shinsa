import { DomainError } from '@shinsa/core';
import { Duration, Effect, Redacted } from 'effect';
import { describeError } from '../log/redact.ts';
import { RemoteClient } from '../remote/client/service.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EffectContext } from '../runtime/engine.ts';
import {
  type Sleep,
  SlackAskFailed,
  SlackCommandFailed,
  type SlackEffect,
  type SlackOptions,
  SlackWaitStopped,
  STATUS_INTERVAL,
} from './schema.ts';
import { makeSlack } from './service.ts';

export { SLACK_EVENT_BODY_LIMIT_BYTES, type SlackOptions } from './schema.ts';

function bridgeSleep(sleep: Sleep) {
  return (ms: number, signal: AbortSignal) =>
    Effect.tryPromise({
      try: () => sleep(ms, signal),
      catch: (error) => new SlackWaitStopped({ message: describeError(error) }),
    });
}

export class Slack {
  readonly #handle: Effect.Success<ReturnType<typeof makeSlack>>;

  constructor(options: SlackOptions) {
    const { engine, remote, ask } = options;
    const client = edgeRuntime.runSync(
      RemoteClient.use((remoteClient) => Effect.succeed(remoteClient)).pipe(
        Effect.provide(remote.control.layer)
      )
    );
    this.#handle = edgeRuntime.runSync(
      makeSlack({
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, { id }),
            catch: (error) =>
              error instanceof DomainError
                ? error
                : new SlackCommandFailed({ message: describeError(error) }),
          }).pipe(Effect.asVoid),
        credentials: Effect.sync(() => (remote.isEnabled ? remote.store.file.credentials : null)),
        appOrigin: Effect.sync(() => remote.appOrigin),
        relay: client.slack,
        token: (machineToken) => Redacted.make(machineToken),
        ask: (system, prompt, schema) =>
          Effect.tryPromise({
            try: () => ask<unknown>(system, prompt, schema),
            catch: (error) => new SlackAskFailed({ message: describeError(error) }),
          }),
        now: Effect.sync(options.now ?? Date.now),
        sleep: options.sleep ? bridgeSleep(options.sleep) : null,
        statusInterval:
          options.statusIntervalMs === undefined
            ? STATUS_INTERVAL
            : Duration.millis(options.statusIntervalMs),
      })
    );
  }

  handleEvents(request: Request) {
    return edgeRuntime.runPromise(this.#handle.handleEvents(request));
  }

  handleInteractions(request: Request) {
    return edgeRuntime.runPromise(this.#handle.handleInteractions(request));
  }

  handleTunnel(request: Request, url: URL) {
    return edgeRuntime.runPromise(this.#handle.handleTunnel(request, url));
  }

  evaluate(effect: SlackEffect<'slack.evaluate'>, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.evaluate(effect, context.key));
  }

  post(effect: SlackEffect<'slack.post'>) {
    return edgeRuntime.runPromise(this.#handle.post(effect));
  }

  status(effect: SlackEffect<'slack.status'>, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.status(effect, context.key, context.signal));
  }

  snapshot() {
    return edgeRuntime.runPromise(this.#handle.snapshot);
  }

  disconnect() {
    return edgeRuntime.runPromise(this.#handle.disconnect);
  }
}
