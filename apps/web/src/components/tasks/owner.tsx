import type { Task, TeamFeedTask } from '@shinsa/core';
import { Icon, type IconName } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { TEAM_ICON } from '@/components/focus/menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { UserTag } from '@/components/people/user-tag.tsx';
import { useTaskOwnership } from '@/hooks/use-task-ownership.ts';
import { useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { resolveSharedProfile } from '@/lib/remote/users.ts';
import { ViewerContext } from '@/lib/remote/viewer.ts';
import { isOwnTask, MACHINE_OWNER_LABEL } from '@/lib/tasks/owner.ts';
import { describeTeamTaskOwner, describeTeamTaskPlace } from '@/lib/teams/feeds.ts';
import { selectFeedMachine } from '@/lib/teams/presence.ts';

const YOU_OWNER = 'You';

const OWNER_TAG = 'min-w-0 truncate text-xs text-fg-3';

function PlainOwner({ icon, label, detail }: { icon: IconName; label: string; detail?: string }) {
  const owner = (
    <span className='flex min-w-0 items-center gap-1 text-xs text-fg-3'>
      <Icon size='sm' name={icon} className='shrink-0 text-fg-2' />
      <Truncate>{label}</Truncate>
    </span>
  );
  return detail ? <Hint label={detail}>{owner}</Hint> : owner;
}

function YourOwnerMark() {
  const signedIn = React.useContext(ViewerContext);
  const remoteOwner = useRemoteSnapshot()?.access?.owner;
  const user = signedIn ?? remoteOwner;
  if (!user) return <PlainOwner icon='IconUser' label={YOU_OWNER} />;
  return <UserTag user={user} label={YOU_OWNER} className={OWNER_TAG} />;
}

export function TaskOwnerMark({ task }: { task: Task }) {
  const ownership = useTaskOwnership();
  if (isOwnTask(task, ownership)) return <YourOwnerMark />;
  if (!task.owner) return <PlainOwner icon='IconUser' label={MACHINE_OWNER_LABEL} />;
  return <UserTag user={task.owner} className={OWNER_TAG} />;
}

export function TeammateOwnerMark({ entry }: { entry: TeamFeedTask }) {
  const feed = useTeamFeed();
  const note = describeTeamTaskPlace(entry);
  const userId = selectFeedMachine(feed, entry.teamId, entry.instanceId)?.userId ?? null;
  if (!entry.owner) return <PlainOwner icon={TEAM_ICON} label={describeTeamTaskOwner(entry)} detail={note} />;
  const user = resolveSharedProfile(entry.owner, entry.ownerProfile);
  return <UserTag user={user} userId={userId} note={note} className={OWNER_TAG} />;
}
