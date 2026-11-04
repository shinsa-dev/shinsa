import { Effect } from 'effect';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { forkApp } from '@/lib/runtime/app.ts';
import { StepFailed } from '@/lib/runtime/schema.ts';

interface MenuAnswer<Value> {
  value: Value | null;
  failure: string | null;
}

const WAITING: MenuAnswer<never> = { value: null, failure: null };

export function useMenuAnswer<Value>(request: () => Promise<Value>) {
  const [answer, setAnswer] = React.useState<MenuAnswer<Value>>(WAITING);
  const latest = React.useRef(0);

  function ask(open: boolean) {
    if (!open) return;
    latest.current += 1;
    const asked = latest.current;
    const settle = (next: MenuAnswer<Value>) =>
      Effect.sync(() => {
        if (asked === latest.current) setAnswer(next);
      });
    setAnswer(WAITING);
    forkApp(
      Effect.tryPromise({
        try: request,
        catch: (error) => new StepFailed({ message: describeFailure(error) }),
      }).pipe(
        Effect.matchEffect({
          onSuccess: (value) => settle({ value, failure: null }),
          onFailure: (failed) => settle({ value: null, failure: failed.message }),
        })
      )
    );
  }

  return { ...answer, ask };
}
