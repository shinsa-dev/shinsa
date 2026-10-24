import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';

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
    const settle = (next: MenuAnswer<Value>) => {
      if (asked === latest.current) setAnswer(next);
    };
    setAnswer(WAITING);
    request().then(
      (value) => settle({ value, failure: null }),
      (error: unknown) => settle({ value: null, failure: describeFailure(error) })
    );
  }

  return { ...answer, ask };
}
