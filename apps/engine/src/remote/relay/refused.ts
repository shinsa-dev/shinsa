import { Effect, Layer } from 'effect';
import { RelayConnectFailed } from './schema.ts';
import { RelayConnector } from './service.ts';

export function createRefusedConnector(message: string) {
  return Layer.succeed(RelayConnector, {
    open: () => Effect.fail(new RelayConnectFailed({ message, status: null })),
  });
}
