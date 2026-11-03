import { Duration } from 'effect';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { ShinsaTools } from '../../tools/index.ts';
import { HEARTBEAT_MS, type ToolEndpoint, type ToolEndpointOptions } from './mcp/schema.ts';
import { makeToolEndpoint } from './mcp/service.ts';

export type { ToolEndpoint, ToolEndpointOptions } from './mcp/schema.ts';

export function startToolEndpoint(tools: ShinsaTools, options: ToolEndpointOptions = {}): ToolEndpoint {
  const handle = edgeRuntime.runSync(
    makeToolEndpoint({
      tools,
      heartbeat: Duration.millis(options.heartbeatMs ?? HEARTBEAT_MS),
      token: crypto.randomUUID(),
    })
  );
  return {
    url: handle.url,
    headers: handle.headers,
    close: () => edgeRuntime.runSync(handle.close),
  };
}
