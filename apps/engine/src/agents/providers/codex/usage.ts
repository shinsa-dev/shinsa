import { tmpdir } from 'node:os';
import { Duration, Effect } from 'effect';
import { describeError } from '../../../log/index.ts';
import { edgeRuntime } from '../../../runtime/edge.ts';
import type { ProviderUsageReading } from '../types.ts';
import type { CodexRuntime } from './session/schema.ts';
import { selectCodexOAuthLogin } from './usage/auth.ts';
import { resolveCodexHome } from './usage/readings.ts';
import { type CodexUsageOptions, CodexUsageUnreachable, USAGE_TIMEOUT_MS } from './usage/schema.ts';
import { readUsage } from './usage/service.ts';

export {
  createCodexWindow,
  parseChatGptBaseUrl,
  parseCodexOAuthUsage,
  parseCodexRateLimits,
  resolveCodexFastMode,
  resolveCodexHome,
  resolveCodexUsageUrl,
} from './usage/readings.ts';
export type { CodexUsageOptions } from './usage/schema.ts';

export function readCodexOAuthLogin(home: string) {
  return edgeRuntime.runSync(selectCodexOAuthLogin(home));
}

export function readCodexUsage(
  runtime: CodexRuntime,
  options: CodexUsageOptions = {}
): Promise<ProviderUsageReading> {
  const request = options.requestHttp ?? fetch;
  return edgeRuntime.runPromise(
    readUsage({
      home: resolveCodexHome({ ...Bun.env, ...options.env }),
      now: Effect.sync(options.now ?? Date.now),
      requestHttp: (url, init) =>
        Effect.tryPromise({
          try: (signal) => request(url, { ...init, signal }),
          catch: (error) => new CodexUsageUnreachable({ message: describeError(error) }),
        }),
      executable: Effect.promise(() => runtime.resolveExecutable()),
      env: runtime.env,
      cwd: tmpdir(),
      timeout: Duration.millis(options.timeoutMs ?? USAGE_TIMEOUT_MS),
    })
  );
}
