import * as React from 'react';
import { useSettings } from '@/lib/connection/selectors.ts';
import { connection, useMachines, useRemoteSnapshot } from '@/lib/connection/socket.ts';
import { ViewerContext } from '@/lib/remote/viewer.ts';
import { resolveTaskOwnership } from '@/lib/tasks/owner.ts';

export function useTaskOwnership() {
  const signedIn = React.useContext(ViewerContext);
  const remote = useRemoteSnapshot();
  const settings = useSettings();
  const machines = useMachines();
  const viewer = signedIn?.login ?? remote?.access?.owner.login ?? remote?.owner ?? null;
  return React.useMemo(
    () =>
      resolveTaskOwnership({
        settings,
        machines,
        viewer,
        selectTaskMachine: (taskId) => connection.selectMachine(taskId)?.id ?? null,
      }),
    [settings, machines, viewer]
  );
}
