import type { TeamViewTarget } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { useSharedView } from '@/hooks/use-shared-view.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { SHARED_READ_ONLY_NOTE } from '@/lib/share/page.ts';
import {
  openLocalTeamView,
  openTeamChannel,
  openTeamTaskStream,
  type TeamTransport,
} from '@/lib/teams/channel.ts';
import { resolveTeamTaskPath } from '@/lib/teams/feeds.ts';

function useHostedKey(teamId: string) {
  const services = React.useContext(RemoteServicesContext);
  const [key, setKey] = React.useState<string | null | undefined>(undefined);
  React.useEffect(() => {
    if (!services) return;
    let live = true;
    void services.teamKeys.selectTeamKey(teamId).then((stored) => {
      if (live) setKey(stored?.key ?? null);
    });
    return () => {
      live = false;
    };
  }, [services, teamId]);
  return key;
}

function TeamTaskView({ target, transport }: { target: TeamViewTarget; transport: TeamTransport }) {
  const load = useSharedView(resolveTeamTaskPath(target), (handlers) =>
    openTeamTaskStream(transport, handlers)
  );
  if (load.status === 'loading') return <LoadingLine label='Opening the team task' className='m-auto' />;
  if (load.status === 'error') {
    return (
      <EmptyState
        icon='IconEyeSlash'
        title={load.gone ? 'This task is not shown to your team' : 'The team task did not load'}
        description={load.message}
      />
    );
  }
  return <SharedTaskPage view={load.view} note={SHARED_READ_ONLY_NOTE} viewer={null} />;
}

function HostedTeamTask({ target }: { target: TeamViewTarget }) {
  const key = useHostedKey(target.teamId);
  if (key === undefined) return <LoadingLine label='Opening the team task' className='m-auto' />;
  if (key === null)
    return (
      <EmptyState
        icon='IconKey1'
        title='Add the team to this browser'
        description={
          'This browser has no key for the team. Open the team’s join link here once to read its tasks.'
        }
      />
    );
  return (
    <TeamTaskView
      target={target}
      transport={(handlers) =>
        openTeamChannel(
          {
            teamId: target.teamId,
            instanceId: target.instanceId,
            key,
            view: { kind: 'task', taskId: target.taskId },
          },
          handlers
        )
      }
    />
  );
}

export function TeamTaskPage({ target }: { target: TeamViewTarget }) {
  if (isRemoteBuild()) return <HostedTeamTask target={target} />;
  return <TeamTaskView target={target} transport={(handlers) => openLocalTeamView(target, handlers)} />;
}
