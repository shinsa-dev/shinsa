import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { readRetryAfter } from '../../../../accounts/usage.ts';
import type { UsageRead } from '../../../../accounts/usage.ts';
import { describeError } from '../../../../log/index.ts';
import type { ProviderUsageReading } from '../../types.ts';
import { makeCodexClient } from '../client/service.ts';
import { CodexCallFailed } from '../complete/schema.ts';
import { readCodexText, selectCodexOAuthLogin } from './auth.ts';
import {
  isFields,
  parseChatGptBaseUrl,
  parseCodexOAuthUsage,
  parseCodexRateLimits,
  readTrimmedText,
  resolveCodexUsageUrl,
} from './readings.ts';
import { type CodexUsageDefinition, CodexUsageUnreachable, NOT_CHATGPT, SIGNED_OUT } from './schema.ts';

export const readUsage = Effect.fn('CodexUsage.read')(function* (definition: CodexUsageDefinition) {
  const { home, timeout } = definition;

  const fail = (
    reason: 'expired' | 'limited' | 'failed',
    detail: string,
    retryAfterMs: number | null = null
  ): UsageRead => ({ ok: false, reason, detail, retryAfterMs });

  const answer = (
    read: UsageRead,
    email: string | null = null,
    plan: string | null = null
  ): ProviderUsageReading => ({
    read,
    email,
    plan,
  });

  const requestOAuthUsage = Effect.gen(function* () {
    const login = yield* selectCodexOAuthLogin(home);
    if (!login) return null;
    const config = (yield* readCodexText(join(home, 'config.toml'))) ?? '';
    const url = resolveCodexUsageUrl(parseChatGptBaseUrl(config));
    const sent = yield* Effect.result(
      definition
        .requestHttp(url, {
          headers: {
            Authorization: `Bearer ${login.accessToken}`,
            Accept: 'application/json',
            'User-Agent': 'shinsa',
            ...(login.accountId ? { 'ChatGPT-Account-Id': login.accountId } : {}),
          },
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () => Effect.fail(new CodexUsageUnreachable({ message: 'The operation timed out.' })),
          })
        )
    );
    if (Result.isFailure(sent))
      return answer(fail('failed', `Could not reach Codex: ${sent.failure.message}`));
    const response = sent.success;
    if (response.status === 401 || response.status === 403) return null;
    if (response.status === 429)
      return answer(fail('limited', 'Rate limited by Codex.', readRetryAfter(response)));
    if (!response.ok) return answer(fail('failed', `Codex answered ${response.status}.`));
    const body = yield* Effect.result(
      Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: (error) => new CodexUsageUnreachable({ message: describeError(error) }),
      })
    );
    if (Result.isFailure(body)) {
      return answer(fail('failed', `Codex’s answer could not be read: ${body.failure.message}`));
    }
    const parsed = parseCodexOAuthUsage(body.success, yield* definition.now);
    return answer(
      { ok: true, windows: parsed.windows, fastMode: parsed.fastMode },
      parsed.email,
      parsed.plan
    );
  });

  const readAccount = Effect.fn('CodexUsage.readAccount')(function* (path: string) {
    const connection = yield* makeCodexClient({ path, cwd: definition.cwd, env: definition.env });
    yield* connection.initialize;
    const account = yield* connection.request('account/read', { refreshToken: false });
    const identity = isFields(account) && isFields(account.account) ? account.account : null;
    if (!identity) return answer(fail('expired', SIGNED_OUT));
    const email = readTrimmedText(identity, 'email');
    if (identity.type === 'apiKey') return answer({ ok: true, windows: [], fastMode: 'available' }, email);
    if (identity.type !== 'chatgpt') return answer(fail('failed', NOT_CHATGPT), email);
    const parsed = parseCodexRateLimits(yield* connection.request('account/rateLimits/read', {}));
    return answer(
      { ok: true, windows: parsed.windows, fastMode: parsed.fastMode },
      email,
      parsed.plan ?? readTrimmedText(identity, 'planType')
    );
  });

  const requestAppServerUsage = Effect.gen(function* () {
    const executable = yield* definition.executable;
    if (!executable.ok) return answer(fail('failed', executable.message));
    return yield* readAccount(executable.path).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new CodexCallFailed({ message: 'Codex did not answer in time.' })),
      }),
      Effect.scoped,
      Effect.catch((failure) =>
        Effect.succeed(answer(fail('failed', `Codex could not report its usage: ${failure.message}`)))
      )
    );
  });

  return (yield* requestOAuthUsage) ?? (yield* requestAppServerUsage);
});
