import { Config, Context, Effect, Layer, type Redacted, Schedule, Schema } from 'effect';

export class TunnelError extends Schema.TaggedError<TunnelError>()('TunnelError', {
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

export interface Connection {
  readonly url: string;
  readonly close: Effect.Effect<void>;
}

export class Connector extends Context.Service<
  Connector,
  {
    open(token: Redacted.Redacted): Effect.Effect<Connection, TunnelError>;
  }
>()('shinsa/guide/Connector') {}

const CONNECT_TIMEOUT = '30 seconds';

const RECONNECT_SCHEDULE = Schedule.min([
  Schedule.exponential('1 second'),
  Schedule.spaced('30 seconds'),
]).pipe(
  Schedule.setInputType<TunnelError>(),
  Schedule.while(({ input }) => input.retryable)
);

export class Tunnel extends Context.Service<Tunnel, { readonly url: string }>()('shinsa/guide/Tunnel') {
  static readonly layer = Layer.effect(
    Tunnel,
    Effect.gen(function* () {
      const connector = yield* Connector;
      const token = yield* Config.Redacted('GUIDE_TUNNEL_TOKEN');
      const connect = connector.open(token).pipe(
        Effect.timeoutOrElse({
          duration: CONNECT_TIMEOUT,
          orElse: () => new TunnelError({ message: 'The tunnel did not connect in time.', retryable: true }),
        }),
        Effect.retry(RECONNECT_SCHEDULE)
      );
      const connection = yield* Effect.acquireRelease(connect, (open) => open.close);
      return Tunnel.of({ url: connection.url });
    })
  );
}
