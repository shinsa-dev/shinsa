import type { Duration, Effect } from 'effect';
import { Schema } from 'effect';
import type { ShinsaTools } from '../../../tools/index.ts';

export interface ToolEndpoint {
  url: string;
  headers: Record<string, string>;
  close: () => void;
}

export interface ToolEndpointOptions {
  heartbeatMs?: number;
}

export class ToolEndpointFailed extends Schema.TaggedError<
  ToolEndpointFailed,
  { readonly brand: unique symbol }
>()('ToolEndpointFailed', { message: Schema.String }) {}

export interface ToolEndpointDefinition {
  readonly tools: ShinsaTools;
  readonly heartbeat: Duration.Duration;
  readonly token: string;
}

export interface ToolEndpointHandle {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly close: Effect.Effect<void>;
}

export type ProgressToken = string | number;

export const HEARTBEAT_MS = 10_000;

export const ENDPOINT_PATH = '/mcp';

export const KEEP_ALIVE = new TextEncoder().encode(': shinsa\n\n');
