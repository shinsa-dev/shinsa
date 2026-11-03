import type { TeamFeedTask } from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { Hint } from '@/components/overlays/hint.tsx';
import { PriorityIcon } from '@/components/status/priority-icon.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { TeammateOwnerMark } from '@/components/tasks/owner.tsx';
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
import { type FocusTeam, listFocusTeams } from '@/lib/focus.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { TeamEntry } from '@/lib/tasks/groups.ts';
import {
  listHeldTeamMachines,
  listTeamFeedTasks,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  resolveTeamTaskTarget,
  selectTeamTaskHeldAt,
} from '@/lib/teams/feeds.ts';
import { navigate } from '@/router.ts';

export interface TeamTasks {
  teams: FocusTeam[];
  entries: TeamEntry[];
}

export function useTeamTasks(): TeamTasks {
  const remote = useRemoteSnapshot();
  const teams = React.useMemo(() => listFocusTeams(remote), [remote]);
  const feed = useTeamFeed();
  const machines = useMachines();
  const entries = React.useMemo(() => {
    if (teams.length === 0) return [];
    const held = listHeldTeamMachines(feed);
    const teamIds = new Set(teams.map((team) => team.id));
    return listTeamFeedTasks(feed, teamIds, new Set(machines.map((machine) => machine.id))).map(
      (entry): TeamEntry => ({
        entry,
        state: resolveTeamTaskState(entry),
        heldAt: selectTeamTaskHeldAt(held, entry),
      })
    );
  }, [feed, teams, machines]);
  return { teams, entries };
}

function openTeamTask(entry: TeamFeedTask) {
  navigate(resolveTeamTaskPath(resolveTeamTaskTarget(entry)));
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
    // oxlint-disable-next-line shinsa/use-semantic-elements -- the row holds a pull request link, so it cannot be a button
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
      <span className='flex max-md:hidden'>
        <TeammateOwnerMark entry={entry} />
      </span>
      <span className='flex min-w-0 items-center gap-1.5 max-md:hidden'>
        {heldAt === null ? <KindMark state={state} task={task} /> : <OfflineBadge heldAt={heldAt} />}
        <RowStatus state={state} task={task} />
      </span>
      <span className='max-md:hidden'>
        <PullRequestBadge task={task} />
      </span>
      <span className='text-right text-2xs text-fg-2'>
        <TimeAgo at={task.updatedAt} compact />
      </span>
    </div>
  );
});
