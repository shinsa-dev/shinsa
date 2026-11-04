import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Effect } from 'effect';

export interface ClaudeProcessDefinition {
  readonly onSpawn: (pid: number) => Effect.Effect<void>;
}

export interface ClaudeProcessHandle {
  readonly spawn: (options: SpawnOptions) => Effect.Effect<SpawnedProcess>;
  readonly readStderr: Effect.Effect<string>;
  readonly terminate: Effect.Effect<void>;
}

export const STDERR_TAIL_CHARS = 8_000;
