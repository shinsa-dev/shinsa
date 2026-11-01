import type { ShinsaState, TeamFeedTask } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import * as React from 'react';
import { TEAM_ICON } from '@/components/focus/menu.tsx';
import { ListRow } from '@/components/layout/list-row.tsx';
import { DisclosureHeader } from '@/components/layout/surface/disclosure-header.tsx';
import { Hint } from '@/components/overlays/hint.tsx';
import { UserTag } from '@/components/people/user-tag.tsx';
import { WideSection } from '@/components/queue/queue.tsx';
import { TaskGlyph } from '@/components/status/glyphs.tsx';
import { StatusText, TaskMeta } from '@/components/status/text.tsx';
import { TaskHandle } from '@/components/task/handle.tsx';
import { PullRequestBadge } from '@/components/tasks/pull-request-badge.tsx';
import { TASK_LIST_COLUMNS } from '@/components/tasks/row.tsx';
import { TimeAgo } from '@/components/text/time-ago.tsx';
import { useMachines, useRemoteSnapshot, useTeamFeed } from '@/lib/connection/socket.ts';
import { type FocusTeam, listFocusTeams, selectFocusTeam } from '@/lib/focus.ts';
import { resolveHomeSectionId } from '@/lib/home.ts';
import { createDisclosureId, useDisclosure } from '@/lib/preferences/disclosure.ts';
import { resolveSharedProfile } from '@/lib/remote/users.ts';
import {
  describeTeamTaskOwner,
  describeTeamTaskPlace,
  listOpenTeamFeedTasks,
  listTeamFeedTasks,
  matchesTeamTaskSearch,
  resolveTeamTaskPath,
  resolveTeamTaskState,
  resolveTeamTaskTarget,
} from '@/lib/teams/feeds.ts';
import { navigate } from '@/router.ts';

const TEAMMATES_TITLE = 'Teammates';

export interface FocusedTeamTasks {
  team: FocusTeam;
  tasks: TeamFeedTask[];
}

export function useFocusedTeamTasks(state: ShinsaState): FocusedTeamTasks | null {
  const team = selectFocusTeam(state, listFocusTeams(useRemoteSnapshot()));
  const feed = useTeamFeed();
  const machines = useMachines();
  const teamId = team?.id ?? null;
  const tasks = React.useMemo(
    () => (teamId ? listTeamFeedTasks(feed, teamId, new Set(machines.map((machine) => machine.id))) : []),
    [feed, teamId, machines]
  );
  return team ? { team, tasks } : null;
}

function openTeamTask(entry: TeamFeedTask) {
  navigate(resolveTeamTaskPath(resolveTeamTaskTarget(entry)));
}

function OwnerName({ entry, detail }: { entry: TeamFeedTask; detail?: string }) {
  if (!entry.owner) return describeTeamTaskOwner(entry);
  return <UserTag user={resolveSharedProfile(entry.owner, entry.ownerProfile)} detail={detail} />;
}

function OwnerMark({ entry }: { entry: TeamFeedTask }) {
  const mark = <Icon size='sm' name={TEAM_ICON} className='shrink-0' />;
  if (entry.owner)
    return (
      <span className='inline-flex min-w-0 items-center gap-1.5 text-fg-2'>
        {mark}
        <Truncate>
          <OwnerName entry={entry} detail={describeTeamTaskPlace(entry)} />
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

const TeamTaskListRow = React.memo(function TeamTaskListRowItem({ entry }: { entry: TeamFeedTask }) {
  const state = React.useMemo(() => resolveTeamTaskState(entry), [entry]);
  const { task } = entry;
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
      className={`grid h-9 w-full cursor-pointer items-center gap-4 border-border border-b px-3 text-left text-xs outline-none hover:not-has-[a:hover]:bg-bg-a1 active:not-has-[a:active]:bg-bg-a1 ${TASK_LIST_COLUMNS}`}
    >
      <span className='flex min-w-0 items-center gap-1.5'>
        <TaskGlyph state={state} task={task} />
        <TaskHandle task={task} />
        <Truncate className='text-fg-4'>{task.title}</Truncate>
      </span>
      <span className='min-w-0 max-md:hidden'>
        <OwnerMark entry={entry} />
      </span>
      <span className='flex min-w-0 items-center max-md:hidden'>
        <StatusText state={state} task={task} className='truncate text-xs' />
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

export function TeamTasksGroup({ focused, search }: { focused: FocusedTeamTasks; search: string }) {
  const disclosure = useDisclosure(createDisclosureId('tasks', 'group', 'team'), true);
  const entries = focused.tasks.filter((entry) => matchesTeamTaskSearch(entry, search));
  if (entries.length === 0) return null;
  return (
    <section className='flex flex-col'>
      <DisclosureHeader
        disclosure={disclosure}
        strip='block'
        chevron='glyph'
        className='sticky top-0 z-10 w-full gap-2 bg-bg-1 ps-3 font-medium text-2xs text-fg-3 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border hover:text-fg-4 active:text-fg-4'
      >
        <Icon size='sm' name={TEAM_ICON} />
        {TEAMMATES_TITLE} in {focused.team.name}
        <span className='font-normal text-fg-2 tabular-nums'>{entries.length}</span>
      </DisclosureHeader>
      {disclosure.open &&
        entries.map((entry) => (
          <TeamTaskListRow key={resolveTeamTaskPath(resolveTeamTaskTarget(entry))} entry={entry} />
        ))}
    </section>
  );
}

function TeamTaskHomeRow({ entry }: { entry: TeamFeedTask }) {
  const state = React.useMemo(() => resolveTeamTaskState(entry), [entry]);
  return (
    <ListRow
      leading={<TaskGlyph state={state} task={entry.task} />}
      title={entry.task.title}
      meta={
        <>
          <OwnerName entry={entry} /> · <TaskMeta state={state} task={entry.task} />
        </>
      }
      trailing={<TimeAgo at={entry.task.updatedAt} compact />}
      onClick={() => openTeamTask(entry)}
    />
  );
}

export function TeamTasksSection({ focused }: { focused: FocusedTeamTasks }) {
  const open = listOpenTeamFeedTasks(focused.tasks);
  return (
    <WideSection
      title={`${TEAMMATES_TITLE} in ${focused.team.name}`}
      count={open.length}
      empty='No teammate has an open task in this team. Their tasks show here, read-only, as soon as they start one.'
      persistId={resolveHomeSectionId('team')}
    >
      {open.map((entry) => (
        <TeamTaskHomeRow key={resolveTeamTaskPath(resolveTeamTaskTarget(entry))} entry={entry} />
      ))}
    </WideSection>
  );
}
