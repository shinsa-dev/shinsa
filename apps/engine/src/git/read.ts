import { Duration, Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { GitRead } from './schema.ts';
import { Git } from './service.ts';

export { decodeText, splitRecords } from './text.ts';
export type { GitRead } from './schema.ts';

export interface GitReadOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  literal?: boolean;
  env?: Record<string, string>;
  maxLines?: number;
  onData?: (chunk: Uint8Array) => void;
}

export function readGit(args: string[], cwd: string, options: GitReadOptions = {}): Promise<GitRead> {
  const { onData } = options;
  return edgeRuntime.runPromise(
    Git.use((git) =>
      git.read(args, cwd, {
        timeout: options.timeoutMs === undefined ? undefined : Duration.millis(options.timeoutMs),
        maxBytes: options.maxBytes,
        maxLines: options.maxLines,
        literal: options.literal,
        env: options.env,
        signal: options.signal,
        onData: onData ? (chunk) => Effect.sync(() => onData(chunk)) : undefined,
      })
    )
  );
}
