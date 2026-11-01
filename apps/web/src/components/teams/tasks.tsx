import type { ShinsaState, TeamFeedTask } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { TEAM_ICON } from '@/components/focus/menu.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { UserTag } from '@/components/people/user-tag.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { PullRequestBadge } from '@/components/tasks/pull-request-badge.tsx';
import {
  KindMark,
  RepoMark,
  RowStatus,
  TASK_LIST_ROW,
  TEAM_TASK_LIST_COLUMNS,
} from '@/components/tasks/row.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useMachines, useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { type FocusTeam, listFocusTeams, selectFocusTeam } from '@/lib/focus.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { formatSince } from '@/lib/format/time.ts';
import { resolveSharedProfile } from '@/lib/remote/users.ts';
import type { TeamEntry } from '@/lib/tasks/groups.ts';
import {
  describeTeamTaskOwner,
  describeTeamTaskPlace,
  listHeldTeamMachines,
  listTeamFeedTasks,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  resolveTeamTaskTarget,
  selectTeamTaskHeldAt,
} from '@/lib/teams/feeds.ts';
import { navigate } from '@/router.ts';

export interface FocusedTeamTasks {
  team: FocusTeam;
  entries: TeamEntry[];
}

export function useFocusedTeamTasks(state: ShinsaState): FocusedTeamTasks | null {
  const team = selectFocusTeam(state, listFocusTeams(useRemoteSnapshot()));
  const feed = useTeamFeed();
  const machines = useMachines();
  const teamId = team?.id ?? null;
  const entries = React.useMemo(() => {
    if (!teamId) return [];
    const held = listHeldTeamMachines(feed);
    return listTeamFeedTasks(feed, teamId, new Set(machines.map((machine) => machine.id))).map(
      (entry): TeamEntry => ({
        entry,
        state: resolveTeamTaskState(entry),
        heldAt: selectTeamTaskHeldAt(held, entry),
      })
    );
  }, [feed, teamId, machines]);
  return team ? { team, entries } : null;
}

function openTeamTask(entry: TeamFeedTask) {
  navigate(resolveTeamTaskPath(resolveTeamTaskTarget(entry)));
}

function OwnerName({ entry }: { entry: TeamFeedTask }) {
  if (!entry.owner) return describeTeamTaskOwner(entry);
  return <UserTag user={resolveSharedProfile(entry.owner, entry.ownerProfile)} />;
}

function OwnerMark({ entry }: { entry: TeamFeedTask }) {
  const mark = <Icon size='sm' name={TEAM_ICON} className='shrink-0' />;
  if (entry.owner)
    return (
      <span className='inline-flex min-w-0 items-center gap-1.5 text-fg-2'>
        <Hint label={describeTeamTaskPlace(entry)}>{mark}</Hint>
        <Truncate>
          <OwnerName entry={entry} />
        </Truncate>
      </span>
    );
  const owner = describeTeamTaskOwner(entry);
  return (
    <Hint label={entry.machine ? `${owner} on ${entry.machine}, read-only` : `${owner}, read-only`}>
      <span className='inline-flex min-w-0 items-center gap-1.5 text-fg-2'>
        {mark}
        <Truncate>{owner}</Truncate>
      </span>
    </Hint>
  );
}

export function OfflineBadge({ heldAt }: { heldAt: number }) {
  return (
    <Hint label='Their machine is offline' detail={formatSince('Updated', heldAt)}>
      <Badge size='sm'>Offline</Badge>
    </Hint>
  );
}

export const TeamTaskListRow = React.memo(function TeamTaskListRowItem({ team }: { team: TeamEntry }) {
  const { entry, state, heldAt } = team;
  const { task } = entry;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the row holds a pull request link, so it cannot be a button
    <div
      role='button'
      tabIndex={0}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target as Node)) openTeamTask(entry);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) openTeamTask(entry);
      }}
      className={`${TASK_LIST_ROW} ${TEAM_TASK_LIST_COLUMNS}`}
    >
      <span className='flex min-w-0 items-center gap-1.5'>
        <Hint label={`${PRIORITY_LABEL[task.priority]} priority`}>
          <span className='grid size-4 shrink-0 place-items-center'>
            <PriorityIcon priority={task.priority} />
          </span>
        </Hint>
        <TaskHandle task={task} />
        <Truncate className='text-fg-4'>{task.title}</Truncate>
      </span>
      <span className='flex min-w-0 items-center gap-1.5 text-fg-2 max-md:hidden'>
        {repo && <RepoMark state={state} repo={repo} />}
        <Truncate>{repo?.name ?? 'No repository'}</Truncate>
      </span>
      <span className='min-w-0 max-md:hidden'>
        <OwnerMark entry={entry} />
      </span>
      <span className='flex min-w-0 items-center gap-1.5 max-md:hidden'>
        {heldAt === null ? <KindMark state={state} task={task} /> : <OfflineBadge heldAt={heldAt} />}
        <RowStatus state={state} task={task} />
      </span>
      <span className='max-md:hidden'>
        <PullRequestBadge task={task} />
      </span>
      <span className='text-right text-2xs text-fg-2'>
        <TimeAgo at={task.updatedAt} />
      </span>
    </div>
  );
});
