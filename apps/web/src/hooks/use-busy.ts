import { Effect } from 'effect';
import * as React from 'react';
import { runApp } from '@/lib/runtime/app.ts';

export function useBusy<Key extends string>() {
  const [busy, setBusy] = React.useState<Key | null>(null);

  function run(key: Key, action: () => Promise<boolean>) {
    return runApp(
      Effect.sync(() => setBusy(key)).pipe(
        Effect.andThen(Effect.promise(action)),
        Effect.ensuring(Effect.sync(() => setBusy(null)))
      )
    );
  }

  return { busy, run };
}
