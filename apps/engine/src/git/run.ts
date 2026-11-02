import { Duration } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { CommandOptions } from '../shell/index.ts';
import { Git } from './service.ts';

export function runGitOrThrow(args: string[], cwd: string, options: CommandOptions = {}) {
  const { timeoutMs } = options;
  return edgeRuntime.runPromise(
    Git.use((git) =>
      git.run(args, cwd, {
        input: options.input,
        env: options.env,
        signal: options.signal,
        timeout: timeoutMs === undefined || timeoutMs === null ? timeoutMs : Duration.millis(timeoutMs),
      })
    )
  );
}
