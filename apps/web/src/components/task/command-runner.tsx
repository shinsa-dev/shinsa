import type { ShinsaState, Task } from '@shinsa/core';
import * as React from 'react';
import { CommandRunnerProvider } from '@/components/text/code-block.tsx';
import { openTaskTerminal, selectTaskTerminal } from '@/lib/connection/terminals.ts';

export function TaskCommandRunner({
  state,
  task,
  children,
}: {
  state: ShinsaState;
  task: Task;
  children: React.ReactNode;
}) {
  const folder = selectTaskTerminal(state, task)?.place.path ?? null;
  const runner = React.useMemo(
    () => (folder === null ? null : { folder, run: (command: string) => openTaskTerminal(task, command) }),
    [folder, task]
  );
  return <CommandRunnerProvider runner={runner}>{children}</CommandRunnerProvider>;
}
