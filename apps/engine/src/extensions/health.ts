import { Duration } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import { McpClients } from './health/service.ts';
import { MCP_CHECK_TIMEOUT, type McpCheckedStatus, type McpDefinition } from './schema.ts';

export type ServerCheck = (definition: McpDefinition) => Promise<McpCheckedStatus>;

const CHECK_TIMEOUT_MS = Duration.toMillis(MCP_CHECK_TIMEOUT);

export function createServerCheck(timeoutMs = CHECK_TIMEOUT_MS): ServerCheck {
  return (definition) =>
    edgeRuntime.runPromise(McpClients.use((clients) => clients.check(definition, timeoutMs)));
}
