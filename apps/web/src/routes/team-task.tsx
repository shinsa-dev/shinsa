import type { TeamFeedTask, TeamViewTarget } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { SharedTaskPage } from '@/components/share/shared-task-page.tsx';
import { TaskGlyph } from '@/components/status/glyphs.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { StatusText } from '@/components/status/text.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { OfflineBadge } from '@/components/teams/tasks.tsx';
import { useSharedView } from '@/hooks/use-shared-view.ts';
import { useTeamFeed } from '@/lib/connection/socket.ts';
import { isRemoteBuild } from '@/lib/remote/mode.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { SHARED_READ_ONLY_NOTE } from '@/lib/share/page.ts';
import {
  openLocalTeamView,
  openTeamChannel,
  openTeamTaskStream,
  type TeamTransport,
} from '@/lib/teams/channel.ts';
import {
  describeTeamTaskOwner,
  listHeldTeamMachines,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  selectTeamTaskHeldAt,
} from '@/lib/teams/feeds.ts';

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

function useHeldTeamTask(target: TeamViewTarget) {
  const feed = useTeamFeed();
  return React.useMemo(() => {
    const heldAt = selectTeamTaskHeldAt(listHeldTeamMachines(feed), target);
    const entry = feed.tasks.find(
      (task) =>
        task.teamId === target.teamId &&
        task.instanceId === target.instanceId &&
        task.task.id === target.taskId
    );
    return heldAt !== null && entry ? { entry, heldAt } : null;
  }, [feed, target]);
}

function HeldTeamTask({ entry, heldAt }: { entry: TeamFeedTask; heldAt: number }) {
  const state = React.useMemo(() => resolveTeamTaskState(entry), [entry]);
  return (
    <EmptyState
      icon='IconCloudSimpleDisconnected'
      title={entry.task.title}
      description={`${describeTeamTaskOwner(entry)}’s machine is offline, so this is the task as it last stood. The full task opens once the machine is back.`}
    >
      <span className='flex items-center gap-1.5 text-xs'>
        <TaskGlyph state={state} task={entry.task} />
        <TaskHandle task={entry.task} />
        <StatusText state={state} task={entry.task} className='text-xs' />
        <OfflineBadge heldAt={heldAt} />
      </span>
    </EmptyState>
  );
}

export function TeamTaskPage({ target }: { target: TeamViewTarget }) {
  const held = useHeldTeamTask(target);
  if (held) return <HeldTeamTask entry={held.entry} heldAt={held.heldAt} />;
  if (isRemoteBuild()) return <HostedTeamTask target={target} />;
  return <TeamTaskView target={target} transport={(handlers) => openLocalTeamView(target, handlers)} />;
}
