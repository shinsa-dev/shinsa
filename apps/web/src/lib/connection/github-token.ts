import type { GitHubTokenAnswer } from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

const readToken = Effect.fn('GitHubToken.read')(function* () {
  const engine = yield* EngineClient;
  return yield* engine.secrets.githubToken();
});

const writeToken = Effect.fn('GitHubToken.write')(function* (token: string | null) {
  const engine = yield* EngineClient;
  return yield* engine.secrets.writeGitHubToken({ payload: { token } });
});

export function requestGitHubTokenWrite(token: string | null) {
  return runApp(writeToken(token));
}

export function useGitHubToken(enabled: boolean) {
  const [answer, setAnswer] = React.useState<GitHubTokenAnswer | null>(null);
  useAppEffect(
    () =>
      enabled
        ? readToken().pipe(
            Effect.tap((read) => Effect.sync(() => setAnswer(read))),
            Effect.orElseSucceed(() => null)
          )
        : Effect.void,
    [enabled]
  );
  return [answer, setAnswer] as const;
}
