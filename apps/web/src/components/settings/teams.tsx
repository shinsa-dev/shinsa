import {
  listTeamProjectIds,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteTeamEntry,
  type RemoteUser,
  type ShinsaState,
} from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shinsa/ui/components/dialog';
import { Icon } from '@shinsa/ui/components/icon';
import { Input } from '@shinsa/ui/components/input';
import { Truncate } from '@shinsa/ui/components/truncate';
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { NewTeamDialog } from '@/components/teams/new-team-dialog.tsx';
import { ProjectsSelect } from '@/components/teams/projects-select.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { confirmDone, requestWithToast } from '@/lib/connection/commands.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { TEAM_ACTIONS, type TeamActions } from '@/lib/connection/teams.ts';
import { formatSince } from '@/lib/format/time.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { MACHINE_ICON } from '@/lib/remote/mode.ts';
import { describeUserName } from '@/lib/remote/users.ts';
import { describeMemberSince } from '@/lib/remote-access.ts';
import {
  canUseTeams,
  describePeopleCount,
  describeTeamEntry,
  describeTeamsUnavailable,
  hasMachineAccess,
  listProjectChoices,
  listTeamPeople,
  needsTeamLink,
  PEOPLE_SEARCH_LABEL,
  PEOPLE_SEARCH_MIN,
  type ProjectChoice,
  TEAM_LINK_COPY,
  TEAMS_DESCRIPTION,
  TEAMS_SECTION,
  validateTeamLink,
  validateTeamLinkProjects,
} from '@/lib/teams/settings.ts';
import {
  FoldingBlock,
  ROW_INSET,
  SETTING_ROW,
  SETTINGS_SUBHEADING,
  SettingRow,
  SettingsCard,
  SettingsEmpty,
  SettingsSection,
} from './group.tsx';
import { LinkView } from './remote-access.tsx';
import { UserRow } from './user-row.tsx';

type TeamsDialog =
  | { kind: 'create' }
  | { kind: 'link'; teamId: string; name: string; url: string | null }
  | { kind: 'leave'; entry: RemoteTeamEntry }
  | { kind: 'delete'; entry: RemoteTeamEntry }
  | { kind: 'member'; team: RemoteTeam; user: RemoteUser }
  | { kind: 'grant'; team: RemoteTeam; user: RemoteUser; machine: string };

function TeamLinkDialog({
  control,
  teamId,
  name,
  initialUrl,
  actions,
}: {
  control: DialogControl;
  teamId: string;
  name: string;
  initialUrl: string | null;
  actions: TeamActions;
}) {
  const [url, setUrl] = React.useState(initialUrl);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (url) return;
    void requestWithToast(async () => setUrl((await actions.readLink(teamId)).url));
  }, [url, teamId, actions]);

  async function turnOff() {
    setBusy(true);
    await requestWithToast(async () => {
      await actions.removeLink(teamId);
      control.onOpenChange(false);
    }, 'The link is off.');
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Join link for ${name}`}</DialogTitle>
          <DialogDescription>{TEAM_LINK_COPY}</DialogDescription>
        </DialogHeader>
        {url ? (
          <LinkView url={url} />
        ) : (
          <div className='grid h-56 w-full place-items-center'>
            <LoadingLine label='Making the link' />
          </div>
        )}
        <DialogFooter>
          <Button variant='secondary' disabled={busy || !url} onClick={() => void turnOff()}>
            Turn off link
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantDialog({
  control,
  team,
  user,
  machine,
  actions,
}: {
  control: DialogControl;
  team: RemoteTeam;
  user: RemoteUser;
  machine: string;
  actions: TeamActions;
}) {
  const [busy, setBusy] = React.useState(false);
  const name = describeUserName(user);

  async function grant() {
    setBusy(true);
    await requestWithToast(async () => {
      await actions.grantAccess(team.id, user.id);
      control.onOpenChange(false);
    }, `${name} can reach ${machine} now.`);
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Give ${name} access to ${machine}?`}</DialogTitle>
          <DialogDescription>
            {`${name} gets full control of ${machine} in Shinsa Cloud. Take it back under Remote access.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant='secondary' />}>Cancel</DialogClose>
          <Button loading={busy} onClick={() => void grant()}>
            Give access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamLinkRow({
  state,
  entry,
  actions,
}: {
  state: ShinsaState;
  entry: RemoteTeamEntry;
  actions: TeamActions;
}) {
  const [url, setUrl] = React.useState('');
  const [projectIds, setProjectIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const projects = listProjectChoices(state);

  async function add() {
    const problem = validateTeamLink(entry.id, url) ?? validateTeamLinkProjects(projects, projectIds);
    setError(problem);
    if (problem) return;
    setBusy(true);
    await requestWithToast(
      () => actions.join(state, url.trim(), projectIds),
      `${entry.name}’s tasks show here now.`
    );
    setBusy(false);
  }

  return (
    <form
      className={`flex flex-col gap-1.5 py-2 ${ROW_INSET}`}
      onSubmit={(event) => {
        event.preventDefault();
        void add();
      }}
    >
      <span className='text-fg-2 text-xs'>
        This machine has no key for the team yet. Paste the team’s link and pick the projects to share.
      </span>
      <div className='flex items-center gap-1.5'>
        <Input
          aria-label='Team link'
          value={url}
          className='min-w-0 flex-1 font-mono'
          placeholder='https://app.shinsa.dev/share/team#…'
          onChange={(event) => {
            setUrl(event.target.value);
            setError(null);
          }}
        />
        <ProjectsSelect
          label='Projects to share'
          projects={projects}
          chosen={projectIds}
          variant='default'
          onChange={(chosen) => {
            setProjectIds(chosen);
            setError(null);
          }}
        />
        <Button type='submit' size='sm' loading={busy}>
          Add link
        </Button>
      </div>
      {error && <span className='text-destructive-text text-xs'>{error}</span>}
    </form>
  );
}

function TeamRequests({ team, actions }: { team: RemoteTeam; actions: TeamActions }) {
  const now = useNow();
  if (team.role !== 'owner' || team.requests.length === 0) return null;
  return (
    <>
      <p className={SETTINGS_SUBHEADING}>Asking to join</p>
      {team.requests.map((request) => (
        <UserRow
          key={request.user.id}
          user={request.user}
          detail={formatSince('Asked', request.addedAt, now)}
        >
          <Button
            variant='secondary'
            size='sm'
            onClick={() =>
              void requestWithToast(
                () => actions.declineRequest(team.id, request.user.id),
                'Request declined.'
              )
            }
          >
            Decline
          </Button>
          <Button
            size='sm'
            onClick={() =>
              void requestWithToast(
                () => actions.acceptRequest(team.id, request.user.id),
                `${describeUserName(request.user)} joined ${team.name}.`
              )
            }
          >
            Accept
          </Button>
        </UserRow>
      ))}
    </>
  );
}

function TeammateActions({
  team,
  user,
  snapshot,
  onDialog,
}: {
  team: RemoteTeam;
  user: RemoteUser;
  snapshot: RemoteSnapshot;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const granted = hasMachineAccess(snapshot, user.id);
  return (
    <>
      {!granted && snapshot.enabled && (
        <Button
          variant='secondary'
          size='sm'
          icon={MACHINE_ICON}
          onClick={() => onDialog({ kind: 'grant', team, user, machine: snapshot.machineName })}
        >
          Give machine access
        </Button>
      )}
      {team.role === 'owner' && (
        <Button variant='secondary' size='sm' onClick={() => onDialog({ kind: 'member', team, user })}>
          Remove
        </Button>
      )}
    </>
  );
}

function describePerson(base: string, snapshot: RemoteSnapshot, user: RemoteUser) {
  return hasMachineAccess(snapshot, user.id) ? `${base} · Can reach ${snapshot.machineName}` : base;
}

function TeamPeople({
  team,
  snapshot,
  onDialog,
}: {
  team: RemoteTeam;
  snapshot: RemoteSnapshot;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const now = useNow();
  const [query, setQuery] = React.useState('');
  const viewer = snapshot.access?.owner.id ?? null;
  const people = listTeamPeople(team, query);
  const searchable = team.members.length + 1 >= PEOPLE_SEARCH_MIN;
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'people')}
      title='People'
      detail={describePeopleCount(team)}
      startsOpen={!searchable}
    >
      {searchable && (
        <label className='flex h-8 items-center gap-2 border-bg-3 border-b px-2.5'>
          <Icon name='IconMagnifyingGlass' size='sm' className='text-fg-2' />
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={PEOPLE_SEARCH_LABEL}
            aria-label={PEOPLE_SEARCH_LABEL}
            className='min-w-0 flex-1 bg-transparent font-medium text-fg-4 text-xs outline-none placeholder:font-normal placeholder:text-fg-2'
          />
        </label>
      )}
      {people.length === 0 && <SettingsEmpty>No one matches.</SettingsEmpty>}
      {people.map(({ user, member }) => {
        const self = user.id === viewer;
        const base = member ? describeMemberSince(member, now) : 'Owner';
        return (
          <UserRow key={user.id} user={user} detail={describePerson(base, snapshot, user)} self={self}>
            {!self && <TeammateActions team={team} user={user} snapshot={snapshot} onDialog={onDialog} />}
          </UserRow>
        );
      })}
    </FoldingBlock>
  );
}

function TeamHeader({
  entry,
  onDialog,
}: {
  entry: RemoteTeamEntry;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const now = useNow();
  const owns = entry.team?.role === 'owner';
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <Truncate className='font-medium text-fg-4 text-xs'>{entry.name}</Truncate>
        <Truncate className='text-2xs text-fg-2'>{describeTeamEntry(entry, now)}</Truncate>
      </div>
      <div className='flex shrink-0 items-center gap-1.5'>
        {owns ? (
          <>
            <Button variant='secondary' size='sm' onClick={() => onDialog({ kind: 'delete', entry })}>
              Delete team
            </Button>
            <Button
              variant='secondary'
              size='sm'
              icon='IconUserAdd'
              onClick={() => onDialog({ kind: 'link', teamId: entry.id, name: entry.name, url: null })}
            >
              Join link
            </Button>
          </>
        ) : (
          <Button variant='secondary' size='sm' onClick={() => onDialog({ kind: 'leave', entry })}>
            {entry.team ? 'Leave' : 'Withdraw'}
          </Button>
        )}
      </div>
    </div>
  );
}

function TeamCard({
  state,
  snapshot,
  entry,
  projects,
  actions,
  onDialog,
}: {
  state: ShinsaState;
  snapshot: RemoteSnapshot;
  entry: RemoteTeamEntry;
  projects: readonly ProjectChoice[];
  actions: TeamActions;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const { team } = entry;
  return (
    <SettingsCard>
      <TeamHeader entry={entry} onDialog={onDialog} />
      <SettingRow title='Shared projects'>
        <ProjectsSelect
          label={`Projects shared with ${entry.name}`}
          projects={projects}
          chosen={listTeamProjectIds(state, entry.id)}
          onChange={(projectIds) =>
            void requestWithToast(() => actions.writeProjects(state, entry.id, projectIds))
          }
        />
      </SettingRow>
      {needsTeamLink(entry) && <TeamLinkRow state={state} entry={entry} actions={actions} />}
      {team && <TeamRequests team={team} actions={actions} />}
      {team && <TeamPeople team={team} snapshot={snapshot} onDialog={onDialog} />}
    </SettingsCard>
  );
}

function TeamsDialogs({
  dialog,
  state,
  actions,
  onDialog,
}: {
  dialog: ReturnType<typeof useDialogState<TeamsDialog>>;
  state: ShinsaState;
  actions: TeamActions;
  onDialog: (next: TeamsDialog) => void;
}) {
  const { value, control } = dialog;
  switch (value?.kind) {
    case 'create':
      return (
        <NewTeamDialog
          control={control}
          projects={listProjectChoices(state)}
          onSubmit={async (draft) => {
            const name = draft.name.trim();
            return { name, ...(await actions.create(state, name, draft.projectIds)) };
          }}
          onDone={(created) => {
            confirmDone(`${created.name} is made.`);
            onDialog({ kind: 'link', teamId: created.teamId, name: created.name, url: created.url });
          }}
        />
      );
    case 'link':
      return (
        <TeamLinkDialog
          control={control}
          teamId={value.teamId}
          name={value.name}
          initialUrl={value.url}
          actions={actions}
        />
      );
    case 'grant':
      return (
        <GrantDialog
          control={control}
          team={value.team}
          user={value.user}
          machine={value.machine}
          actions={actions}
        />
      );
    case 'leave':
      return (
        <ConfirmDialog
          control={control}
          title={
            value.entry.team
              ? `Leave ${value.entry.name}?`
              : `Withdraw your request to join ${value.entry.name}?`
          }
          body='Your projects stop showing their tasks to the team, and you no longer see your teammates’ tasks. You can ask to join again with its link.'
          action={value.entry.team ? 'Leave team' : 'Withdraw request'}
          onConfirm={() =>
            void requestWithToast(() => actions.leave(value.entry.id), `You left ${value.entry.name}.`)
          }
        />
      );
    case 'delete':
      return (
        <ConfirmDialog
          control={control}
          title={`Delete ${value.entry.name}?`}
          body='The team is deleted for every member, and every view of its tasks closes. This cannot be undone.'
          action='Delete team'
          onConfirm={() =>
            void requestWithToast(() => actions.remove(value.entry.id), `${value.entry.name} is deleted.`)
          }
        />
      );
    case 'member': {
      const name = describeUserName(value.user);
      return (
        <ConfirmDialog
          control={control}
          title={`Remove ${name} from ${value.team.name}?`}
          body={`${name} no longer sees the team’s tasks, and any view of them they have open closes. They can ask to join again with the team’s link.`}
          action='Remove member'
          onConfirm={() =>
            void requestWithToast(
              () => actions.removeMember(value.team.id, value.user.id),
              `${name} was removed.`
            )
          }
        />
      );
    }
    case undefined:
      return null;
  }
}

export function TeamsGroup({
  state,
  snapshot,
  failure,
  actions = TEAM_ACTIONS,
}: {
  state: ShinsaState;
  snapshot: RemoteSnapshot | null;
  failure: string | null;
  actions?: TeamActions;
}) {
  const dialog = useDialogState<TeamsDialog>();
  const usable = canUseTeams(snapshot);
  const projects = listProjectChoices(state);
  const notice = (() => {
    if (!snapshot) return failure ?? 'Reading teams…';
    if (!usable) return describeTeamsUnavailable(snapshot);
    if (snapshot.teams.length === 0)
      return 'You are in no team yet. Make one, or open a teammate’s join link and sign in to ask to join.';
    return null;
  })();
  return (
    <SettingsSection
      title={TEAMS_SECTION}
      description={TEAMS_DESCRIPTION}
      action={
        usable ? (
          <Button
            variant='secondary'
            size='sm'
            icon='IconPlusSmall'
            onClick={() => dialog.show({ kind: 'create' })}
          >
            New team
          </Button>
        ) : undefined
      }
    >
      {notice !== null ? (
        <SettingsCard>
          <SettingsEmpty>{notice}</SettingsEmpty>
        </SettingsCard>
      ) : (
        <div className='flex flex-col gap-2'>
          {usable &&
            snapshot.teams.map((entry) => (
              <TeamCard
                key={entry.id}
                state={state}
                snapshot={snapshot}
                entry={entry}
                projects={projects}
                actions={actions}
                onDialog={dialog.show}
              />
            ))}
        </div>
      )}
      <TeamsDialogs dialog={dialog} state={state} actions={actions} onDialog={dialog.show} />
    </SettingsSection>
  );
}

export function TeamsSettings({ state }: { state: ShinsaState }) {
  const { snapshot, failure } = useRemoteAccess();
  return <TeamsGroup state={state} snapshot={snapshot} failure={failure} />;
}
