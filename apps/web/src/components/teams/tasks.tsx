import {
  listTeamEscalations,
  resolveFocusTeam,
  type ShinsaState,
  type TeamEscalation,
  type TeamFeedTask,
} from '@shinsa/core';
import { Badge } from '@shinsa/ui/components/badge';
import { Icon } from '@shinsa/ui/components/icon';
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
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import {
  type MachineView,
  useMachine,
  useMachines,
  useRemoteSnapshot,
  useTeamFeed,
} from '@/lib/connection/socket.ts';
import { type FocusTeam, listFocusTeams } from '@/lib/focus.ts';
import { PRIORITY_LABEL } from '@/lib/format/labels.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { TeamEntry } from '@/lib/tasks/groups.ts';
import {
  listFullMachineIds,
  listHeldTaskIds,
  listHeldTeamMachines,
  listTeamFeedRefusals,
  listTeamFeedTasks,
  resolveFleetTeamTaskPath,
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
  const listed = useShinsaSelector(listHeldTaskIds);
  const entries = React.useMemo(() => {
    if (teams.length === 0) return [];
    const held = listHeldTeamMachines(feed);
    const teamIds = new Set(teams.map((team) => team.id));
    return listTeamFeedTasks(feed, teamIds, listFullMachineIds(machines), listed ?? undefined).map(
      (entry): TeamEntry => ({
        entry,
        state: resolveTeamTaskState(entry),
        heldAt: selectTeamTaskHeldAt(held, entry),
      })
    );
  }, [feed, teams, machines, listed]);
  return { teams, entries };
}

export function useTeamEscalations(): TeamEscalation[] {
  const { entries } = useTeamTasks();
  return React.useMemo(
    () => listTeamEscalations({ machines: [], tasks: entries.map((item) => item.entry) }),
    [entries]
  );
}

export function TeamFeedRefusals({ state }: { state: ShinsaState }) {
  const remote = useRemoteSnapshot();
  const teams = React.useMemo(() => listFocusTeams(remote), [remote]);
  const feed = useTeamFeed();
  const machines = useMachines();
  const refusals = listTeamFeedRefusals(
    feed,
    teams,
    listFullMachineIds(machines),
    resolveFocusTeam(state, Date.now())
  );
  const [first] = refusals;
  if (!first) return null;
  const label =
    refusals.length === 1
      ? `${first.machine} in ${first.team} is not listing its tasks`
      : `${refusals.length} teammate machines are not listing their tasks`;
  const detail = refusals
    .map((refusal) => (refusals.length === 1 ? refusal.reason : `${refusal.machine}: ${refusal.reason}`))
    .join(' ');
  return (
    <Hint label={label} detail={detail}>
      <span
        role='img'
        aria-label={`${label}. ${detail}`}
        className='grid size-4 shrink-0 cursor-pointer place-items-center'
      >
        <Icon size='sm' name='IconLock' className='cursor-pointer text-fg-2' />
      </span>
    </Hint>
  );
}

function resolveTeamRowPath(entry: TeamFeedTask, machine: MachineView | null) {
  const target = resolveTeamTaskTarget(entry);
  return resolveFleetTeamTaskPath(target, entry.task, machine) ?? resolveTeamTaskPath(target);
}

export function OfflineBadge({ heldAt }: { heldAt: number }) {
  return (
    <Hint label={TEAM_MACHINE_OFFLINE_LABEL} detail={formatSince('Updated', heldAt)}>
      <Badge size='sm'>Offline</Badge>
    </Hint>
  );
}

const TEAM_MACHINE_OFFLINE_LABEL = 'Their machine is offline';

function OfflineMark({ heldAt }: { heldAt: number }) {
  const updated = formatSince('Updated', heldAt);
  return (
    <Hint label={TEAM_MACHINE_OFFLINE_LABEL} detail={updated}>
      <span
        role='img'
        aria-label={`${TEAM_MACHINE_OFFLINE_LABEL}. ${updated}.`}
        className='grid size-4 shrink-0 cursor-pointer place-items-center'
      >
        <Icon size='sm' name='IconCloudOff' className='cursor-pointer text-fg-2' />
      </span>
    </Hint>
  );
}

export const TeamTaskListRow = React.memo(function TeamTaskListRowItem({ team }: { team: TeamEntry }) {
  const { entry, state, heldAt } = team;
  const { task } = entry;
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const machine = useMachine(task.id);
  const openTeamTask = () => navigate(resolveTeamRowPath(entry, machine));
  return (
    // oxlint-disable-next-line shinsa/use-semantic-elements -- the row holds a pull request link, so it cannot be a button
    <div
      role='button'
      tabIndex={0}
      onClick={(event) => {
        if (event.currentTarget.contains(event.target as Node)) openTeamTask();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) openTeamTask();
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
      <span className='flex min-w-0 max-md:hidden'>
        <TeammateOwnerMark entry={entry} />
      </span>
      <span className='flex min-w-0 items-center gap-1.5 max-md:hidden'>
        <KindMark state={state} task={task} />
        <RowStatus state={state} task={task} />
        {heldAt !== null && <OfflineMark heldAt={heldAt} />}
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
