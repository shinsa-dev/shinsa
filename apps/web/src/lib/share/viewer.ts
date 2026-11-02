import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { RemoteClient } from '@/lib/runtime/remote/service.ts';

export function requestViewerLogin() {
  return runApp(
    Effect.gen(function* () {
      const remote = yield* RemoteClient;
      return yield* remote.session.read();
    }).pipe(
      Effect.map((session) => session.user?.login ?? null),
      Effect.orElseSucceed(() => null)
    )
  );
}
