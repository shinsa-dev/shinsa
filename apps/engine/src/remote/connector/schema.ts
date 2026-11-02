import { Context, type Duration, type Effect, type Redacted, Schema, type Scope } from 'effect';

export const CONNECTED_PATTERN = /Registered tunnel connection/;

export const CONNECT_TIMEOUT_MESSAGE = 'cloudflared did not connect within 30 seconds.';

export const OUTPUT_TAIL_CHARS = 2_000;

export const ConnectTimeout = Context.Reference<Duration.Input>(
  'shinsa/engine/remote/connector/ConnectTimeout',
  {
    defaultValue: (): Duration.Input => '30 seconds',
  }
);

export class TunnelConnectFailed extends Schema.TaggedError<
  TunnelConnectFailed,
  { readonly brand: unique symbol }
>()('TunnelConnectFailed', { message: Schema.String }) {}

interface TunnelConnection {
  readonly exited: Effect.Effect<void>;
}

export type OpenTunnel = (
  tunnelToken: Redacted.Redacted<string>,
  localUrl: string
) => Effect.Effect<TunnelConnection, TunnelConnectFailed, Scope.Scope>;
