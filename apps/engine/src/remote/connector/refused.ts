import { Effect, Layer } from 'effect';
import { TunnelConnectFailed } from './schema.ts';
import { TunnelConnector } from './service.ts';

export function createRefusedConnector(message: string) {
  return Layer.succeed(TunnelConnector, { open: () => Effect.fail(new TunnelConnectFailed({ message })) });
}
