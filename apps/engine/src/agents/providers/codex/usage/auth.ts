import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { readTrimmedText } from './readings.ts';
import { CodexAuthFile, type CodexOAuthLogin, CodexUsageUnreachable } from './schema.ts';

const decodeAuthFile = Schema.decodeUnknownOption(CodexAuthFile);

export const readCodexText = Effect.fn('CodexUsage.readText')(function* (path: string) {
  return yield* Effect.try({
    try: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    catch: (error) => new CodexUsageUnreachable({ message: String(error) }),
  }).pipe(Effect.orElseSucceed(() => null));
});

export const selectCodexOAuthLogin = Effect.fn('CodexUsage.selectLogin')(function* (home: string) {
  const text = yield* readCodexText(join(home, 'auth.json'));
  const auth = text === null ? Option.none() : decodeAuthFile(text);
  if (Option.isNone(auth)) return null;
  const { tokens } = auth.value;
  const accessToken = readTrimmedText(tokens, 'access_token');
  if (!accessToken) return null;
  const login: CodexOAuthLogin = { accessToken, accountId: readTrimmedText(tokens, 'account_id') };
  return login;
});
