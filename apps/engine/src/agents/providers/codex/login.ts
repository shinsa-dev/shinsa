import { tmpdir } from 'node:os';
import type { ProviderLogin } from '@shinsa/core';
import { Effect } from 'effect';
import { STATUS_TIMEOUT_MS } from '../../../accounts/status.ts';
import { edgeRuntime } from '../../../runtime/edge.ts';
import { runCommand } from '../../../shell/index.ts';
import type { LoginRunner } from './login/schema.ts';
import { readLogin } from './login/service.ts';
import { CODEX_RUNTIME } from './session.ts';
import type { CodexRuntime } from './session/schema.ts';

export { parseLoginMethod } from './login/method.ts';
export type { LoginRunner } from './login/schema.ts';

export function readCodexLogin(
  runtime: CodexRuntime = CODEX_RUNTIME,
  run: LoginRunner = runCommand
): Promise<ProviderLogin> {
  return edgeRuntime.runPromise(
    readLogin({
      executable: Effect.promise(() => runtime.resolveExecutable()),
      status: (path) =>
        Effect.promise(() =>
          run([path, 'login', 'status'], tmpdir(), { timeoutMs: STATUS_TIMEOUT_MS, env: runtime.env })
        ),
    })
  );
}
