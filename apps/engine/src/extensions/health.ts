import { Duration, Effect, Exit, Scope } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { McpClients } from './health/service.ts';
import { MCP_CHECK_TIMEOUT, type McpCheckedStatus, type McpDefinition, type OpenedClient } from './schema.ts';

export type { OpenedClient } from './schema.ts';
export { listToolInfo } from './tools.ts';

export type ServerCheck = (definition: McpDefinition) => Promise<McpCheckedStatus>;

const CHECK_TIMEOUT_MS = Duration.toMillis(MCP_CHECK_TIMEOUT);

export function withTimeout<T>(work: Promise<T>, timeoutMs: number) {
  return edgeRuntime.runPromise(McpClients.use((clients) => clients.request(() => work, timeoutMs)));
}

export function openMcpClient(
  definition: McpDefinition,
  timeoutMs = CHECK_TIMEOUT_MS
): Promise<OpenedClient> {
  return edgeRuntime.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const close = () => edgeRuntime.runPromise(Scope.close(scope, Exit.void));
      const opened = yield* McpClients.use((clients) => clients.open(definition, timeoutMs)).pipe(
        Scope.provide(scope),
        Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause)))
      );
      return { client: opened.client, stderr: opened.stderr, close };
    })
  );
}

export function createServerCheck(timeoutMs = CHECK_TIMEOUT_MS): ServerCheck {
  return (definition) =>
    edgeRuntime.runPromise(McpClients.use((clients) => clients.check(definition, timeoutMs)));
}
