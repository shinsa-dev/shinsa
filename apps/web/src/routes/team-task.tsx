import type { TeamFeedTask, TeamViewTarget } from '@shinsa/core';
import { EmptyState } from '@shinsa/ui/components/empty-state';
import * as React from 'react';
import { MentionText } from '@/components/people/user-tag.tsx';
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
import { type Mention, resolveFirstName, resolveSharedProfile } from '@/lib/remote/users.ts';
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

const OFFLINE_COPY_NOTE = 'Read-only copy from before their machine went offline';

function TeamTaskView({
  target,
  transport,
  note = SHARED_READ_ONLY_NOTE,
  fallback = null,
}: {
  target: TeamViewTarget;
  transport: TeamTransport;
  note?: string;
  fallback?: React.ReactNode;
}) {
  const load = useSharedView(resolveTeamTaskPath(target), (handlers) =>
    openTeamTaskStream(transport, handlers)
  );
  if (load.status === 'loading') return <LoadingLine label='Opening the team task' className='m-auto' />;
  if (load.status === 'error' && fallback) return fallback;
  if (load.status === 'error') {
    return (
      <EmptyState
        icon='IconEyeSlash'
        title={load.gone ? 'This task is not shown to your team' : 'The team task did not load'}
        description={load.message}
      />
    );
  }
  return <SharedTaskPage view={load.view} note={note} viewer={null} />;
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

function describeHeldTask(entry: TeamFeedTask): Mention {
  const owner = entry.owner ? resolveSharedProfile(entry.owner, entry.ownerProfile) : null;
  return [
    owner ? { user: owner, label: `${resolveFirstName(owner)}’s` } : `${describeTeamTaskOwner(entry)}’s`,
    ' machine is offline, and this machine kept only the task’s summary. The full task opens once their machine is back.',
  ];
}

function HeldTeamTask({ entry, heldAt }: { entry: TeamFeedTask; heldAt: number }) {
  const state = React.useMemo(() => resolveTeamTaskState(entry), [entry]);
  return (
    <EmptyState
      icon='IconCloudSimpleDisconnected'
      title={entry.task.title}
      description={<MentionText mention={describeHeldTask(entry)} />}
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
  const summary = held && <HeldTeamTask entry={held.entry} heldAt={held.heldAt} />;
  if (isRemoteBuild()) return summary || <HostedTeamTask target={target} />;
  return (
    <TeamTaskView
      target={target}
      transport={(handlers) => openLocalTeamView(target, handlers)}
      note={held ? OFFLINE_COPY_NOTE : SHARED_READ_ONLY_NOTE}
      fallback={summary}
    />
  );
}
