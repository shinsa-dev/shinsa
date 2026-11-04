import { Duration, Schedule, Schema } from 'effect';

export interface BenchMachine {
  connectKey: string;
  machineKey: string;
  device: CryptoKeyPair;
}

export const DnsAnswer = Schema.Struct({ Answer: Schema.optionalKey(Schema.Array(Schema.Unknown)) });

export class RemoteBenchFailed extends Schema.TaggedError<
  RemoteBenchFailed,
  { readonly brand: unique symbol }
>()('RemoteBenchFailed', { message: Schema.String }) {}

export class TunnelNotReady extends Schema.TaggedError<TunnelNotReady, { readonly brand: unique symbol }>()(
  'TunnelNotReady',
  { message: Schema.String }
) {}

export const INSTANCE = 'bench';

export const USER_ID = '1';

export const TUNNEL_HOST = 'bench.tunnel.invalid';

export const API_PATHS = ['/api/health', '/api/queue'];

export const PARALLEL = 10;

export const PARALLEL_ROUNDS = 5;

export const TUNNEL_TIMEOUT = Duration.minutes(3);

export const DNS_POLL = Schedule.spaced(Duration.millis(250));

export const HEALTH_POLL = Schedule.spaced(Duration.seconds(1));

export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export const REGISTERED_LINE = 'Registered tunnel connection';
