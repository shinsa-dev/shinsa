import { Effect } from 'effect';
import type { SocketTransport } from './schema.ts';

export function provideTransport(transport: SocketTransport | undefined) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    transport ? Effect.provide(effect, transport) : effect;
}
