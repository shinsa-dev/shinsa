import {
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  listTeamProjectIds,
  type RemoteSnapshot,
  type RemoteTeam,
  type RemoteTeamEntry,
  type RemoteUser,
  type ShinsaState,
  type TeamPresence,
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
import { Truncate } from '@shinsa/ui/components/truncate';
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { SelectField } from '@/components/controls/select-field.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { MentionText } from '@/components/people/user-tag.tsx';
import { LoadingLine } from '@/components/status/loading-line.tsx';
import { NewTeamDialog } from '@/components/teams/new-team-dialog.tsx';
import { ProjectsSelect } from '@/components/teams/projects-select.tsx';
import { MachineExtraDialog, MemberScopesDialog, TeamScopesBlock } from '@/components/teams/scopes.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTeamPresence } from '@/hooks/use-team-presence.ts';
import { confirmDone, requestWithToast } from '@/lib/connection/commands.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { type MachineAccess, useEngineFeature, useMachines, useTeamFeed } from '@/lib/connection/socket.ts';
import { createTeamActions, TEAM_ACTIONS, type TeamActions } from '@/lib/connection/teams.ts';
import { formatSince } from '@/lib/format/time.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeMemberSince } from '@/lib/remote-access.ts';
import { MACHINE_ICON } from '@/lib/remote/mode.ts';
import { describeMachineName } from '@/lib/remote/setup-steps.ts';
import { resolveFirstName } from '@/lib/remote/users.ts';
import { describePresence } from '@/lib/teams/presence.ts';
import { hasOwnScopes, selectExtra } from '@/lib/teams/scopes.ts';
import {
  canUseTeams,
  describePeopleCount,
  describeTeamEntry,
  describeTeamsUnavailable,
  type GrantMachine,
  hasMachineAccess,
  listGrantMachines,
  listProjectChoices,
  listTeamPeople,
  needsTeamLink,
  PEOPLE_SEARCH_LABEL,
  PEOPLE_SEARCH_MIN,
  type ProjectChoice,
  TEAM_LINK_COPY,
  TEAMS_CONNECTING,
  TEAMS_DESCRIPTION,
  TEAMS_SECTION,
  scopeStateToProjects,
  describeKeyAsked,
  describeKeyRequest,
  listKeyRequests,
  TEAM_KEY_OWNER_WAITING,
  TEAM_KEY_UPDATE,
  TEAM_KEY_WAITING,
  listKeylessMachines,
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
import { HostedTeamsSettings } from './hosted-teams.tsx';
import { LinkView } from './remote-access.tsx';
import { TeamMachines } from './team-machines.tsx';
import { UserRow } from './user-row.tsx';

type TeamsDialog =
  | { kind: 'create' }
  | { kind: 'link'; teamId: string; name: string; url: string | null }
  | { kind: 'leave'; entry: RemoteTeamEntry }
  | { kind: 'delete'; entry: RemoteTeamEntry }
  | { kind: 'member'; team: RemoteTeam; user: RemoteUser }
  | { kind: 'scopes'; teamId: string; user: RemoteUser }
  | { kind: 'extra'; teamId: string; user: RemoteUser; machine: GrantMachine }
  | { kind: 'grant'; team: RemoteTeam; user: RemoteUser; machine: GrantMachine };

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

interface GrantMachines {
  owned: readonly MachineAccess[];
  currentId: string | null;
}

const GrantMachinesContext = React.createContext<GrantMachines>({ owned: [], currentId: null });

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
  machine: GrantMachine;
  actions: TeamActions;
}) {
  const { owned } = React.useContext(GrantMachinesContext);
  const choices = listGrantMachines(owned, machine, user.id);
  const [picked, setPicked] = React.useState(machine.id ?? '');
  const [busy, setBusy] = React.useState(false);
  const name = resolveFirstName(user);
  const target = choices.find((choice) => (choice.id ?? '') === picked) ?? machine;
  const title =
    choices.length > 1
      ? `Give ${name} access to a machine?`
      : `Give ${name} access to ${describeMachineName(machine.name)}?`;

  async function grant() {
    setBusy(true);
    const through = target.id === machine.id ? actions : createTeamActions(target.id);
    await requestWithToast(
      async () => {
        await through.grantAccess(team.id, user.id);
        control.onOpenChange(false);
      },
      `${name} can reach ${describeMachineName(target.name)} now.`
    );
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {`${name} gets full control of ${choices.length > 1 ? 'the machine you pick' : describeMachineName(machine.name)} in Shinsa Cloud. Take it back under Remote access.`}
          </DialogDescription>
        </DialogHeader>
        {choices.length > 1 && (
          <SelectField
            label='Machine'
            align='start'
            items={choices.map((choice) => ({ value: choice.id ?? '', label: choice.name }))}
            value={picked}
            onValueChange={setPicked}
          />
        )}
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

function TeamKeyRow({ team, actions, keys }: { team: RemoteTeam; actions: TeamActions; keys: boolean }) {
  const [asked, setAsked] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const owns = team.role === 'owner';

  async function ask() {
    setBusy(true);
    const done = await requestWithToast(() => actions.requestKey(team.id));
    setBusy(false);
    setAsked(done);
  }

  return (
    <div className={`flex items-center gap-3 py-2 ${ROW_INSET}`}>
      <span className='min-w-0 flex-1 text-xs text-pretty text-fg-3'>
        {!keys ? (
          TEAM_KEY_UPDATE
        ) : asked ? (
          <MentionText mention={describeKeyAsked(team)} />
        ) : owns ? (
          TEAM_KEY_OWNER_WAITING
        ) : (
          TEAM_KEY_WAITING
        )}
      </span>
      {keys && !owns && !asked && (
        <Button size='sm' className='shrink-0' loading={busy} onClick={() => void ask()}>
          Request access
        </Button>
      )}
    </div>
  );
}

function TeamKeyRequests({
  team,
  feed,
  actions,
}: {
  team: RemoteTeam;
  feed: TeamFeedSnapshot;
  actions: TeamActions;
}) {
  const asking = listKeyRequests(feed, team.id);
  if (team.role !== 'owner' || asking.length === 0) return null;
  const answer = (machine: TeamFeedMachine, approve: boolean) =>
    void requestWithToast(
      () => actions.answerKey(team.id, machine.instanceId, approve),
      approve ? `“${machine.name}” gets access in a moment.` : 'Request declined.'
    );
  return (
    <>
      <p className={SETTINGS_SUBHEADING}>Asking for access</p>
      {asking.map((machine) => (
        <div key={machine.instanceId} className={SETTING_ROW}>
          <Truncate className='min-w-0 flex-1 text-xs text-fg-4'>
            <MentionText mention={describeKeyRequest(machine, team)} />
          </Truncate>
          <div className='flex shrink-0 items-center gap-1.5'>
            <Button variant='secondary' size='sm' onClick={() => answer(machine, false)}>
              Decline
            </Button>
            <Button size='sm' onClick={() => answer(machine, true)}>
              Give access
            </Button>
          </div>
        </div>
      ))}
    </>
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
                `${resolveFirstName(request.user)} joined ${team.name}.`
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
  rights,
  onDialog,
}: {
  team: RemoteTeam;
  user: RemoteUser;
  snapshot: RemoteSnapshot;
  rights: boolean;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const granted = hasMachineAccess(snapshot, user.id);
  const member = user.id !== team.owner.id;
  const machineId = React.useContext(GrantMachinesContext).currentId;
  return (
    <>
      {rights && member && team.role === 'owner' && (
        <Button
          variant='secondary'
          size='sm'
          onClick={() => onDialog({ kind: 'scopes', teamId: team.id, user })}
        >
          Scopes
        </Button>
      )}
      {!granted && snapshot.enabled && (
        <Button
          variant='secondary'
          size='sm'
          icon={MACHINE_ICON}
          onClick={() =>
            onDialog({
              kind: 'extra',
              teamId: team.id,
              user,
              machine: { id: machineId, name: snapshot.machineName },
            })
          }
        >
          {`On ${describeMachineName(snapshot.machineName)}`}
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

function describePerson(
  base: string,
  snapshot: RemoteSnapshot,
  team: RemoteTeam,
  user: RemoteUser,
  presence: TeamPresence | null,
  now: number
) {
  const parts = [presence ? describePresence(presence, now) : null, base];
  if (hasOwnScopes(team, user.id)) parts.push('Own scopes');
  const extra = snapshot.teams.find((entry) => entry.id === team.id)?.extras ?? [];
  if (selectExtra(extra, user.id).length > 0)
    parts.push(`More on ${describeMachineName(snapshot.machineName)}`);
  if (hasMachineAccess(snapshot, user.id))
    parts.push(`Can reach ${describeMachineName(snapshot.machineName)}`);
  return parts.filter((part) => part !== null).join(' · ');
}

function TeamPeople({
  team,
  snapshot,
  rights,
  onDialog,
}: {
  team: RemoteTeam;
  snapshot: RemoteSnapshot;
  rights: boolean;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const now = useNow();
  const presence = useTeamPresence(team.id);
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
        <label className='flex h-8 items-center gap-2 border-b border-bg-3 px-2.5'>
          <Icon name='IconMagnifyingGlass' size='sm' className='text-fg-2' />
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={PEOPLE_SEARCH_LABEL}
            aria-label={PEOPLE_SEARCH_LABEL}
            className='min-w-0 flex-1 bg-transparent text-xs font-medium text-fg-4 outline-none placeholder:font-normal placeholder:text-fg-2'
          />
        </label>
      )}
      {people.length === 0 && <SettingsEmpty>No one matches.</SettingsEmpty>}
      {people.map(({ user, member }) => {
        const self = user.id === viewer;
        const base = member ? describeMemberSince(member, now) : 'Owner';
        const seen = self ? null : (presence.get(user.id) ?? null);
        return (
          <UserRow
            key={user.id}
            user={user}
            detail={describePerson(base, snapshot, team, user, seen, now)}
            self={self}
            presence={seen}
          >
            {!self && (
              <TeammateActions
                team={team}
                user={user}
                snapshot={snapshot}
                rights={rights}
                onDialog={onDialog}
              />
            )}
          </UserRow>
        );
      })}
    </FoldingBlock>
  );
}

function TeamHeader({
  entry,
  feed,
  onDialog,
}: {
  entry: RemoteTeamEntry;
  feed: TeamFeedSnapshot;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const owns = entry.team?.role === 'owner';
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <Truncate className='text-xs font-medium text-fg-4'>{entry.name}</Truncate>
        <Truncate className='text-2xs text-fg-2'>
          <MentionText mention={describeTeamEntry(entry, feed)} />
        </Truncate>
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
  rights,
  keys,
  feed,
  onDialog,
}: {
  state: ShinsaState;
  snapshot: RemoteSnapshot;
  entry: RemoteTeamEntry;
  projects: readonly ProjectChoice[];
  actions: TeamActions;
  rights: boolean;
  keys: boolean;
  feed: TeamFeedSnapshot;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const { team } = entry;
  return (
    <SettingsCard>
      <TeamHeader entry={entry} feed={feed} onDialog={onDialog} />
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
      {team && needsTeamLink(entry) && <TeamKeyRow team={team} actions={actions} keys={keys} />}
      {team && <TeamRequests team={team} actions={actions} />}
      {team && keys && <TeamKeyRequests team={team} feed={feed} actions={actions} />}
      {team && <TeamMachines team={team} feed={feed} keyless={listKeylessMachines(entry, snapshot)} />}
      {team && rights && <TeamScopesBlock team={team} onUpdate={actions.updateScopes} />}
      {team && <TeamPeople team={team} snapshot={snapshot} rights={rights} onDialog={onDialog} />}
    </SettingsCard>
  );
}

function TeamsDialogs({
  dialog,
  state,
  snapshot,
  actions,
  onDialog,
}: {
  dialog: ReturnType<typeof useDialogState<TeamsDialog>>;
  state: ShinsaState;
  snapshot: RemoteSnapshot | null;
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
    case 'extra': {
      const entry = snapshot?.teams.find((found) => found.id === value.teamId);
      if (!(entry?.team && snapshot)) return null;
      const team = entry.team;
      return (
        <MachineExtraDialog
          control={control}
          team={team}
          user={value.user}
          extra={selectExtra(entry.extras, value.user.id)}
          machineName={snapshot.machineName}
          onUpdate={actions.updateExtra}
          onFullAccess={() => onDialog({ kind: 'grant', team, user: value.user, machine: value.machine })}
        />
      );
    }
    case 'scopes': {
      const team = snapshot?.teams.find((entry) => entry.id === value.teamId)?.team;
      if (!team) return null;
      return (
        <MemberScopesDialog control={control} team={team} user={value.user} onUpdate={actions.updateScopes} />
      );
    }
    case 'leave':
      return (
        <ConfirmDialog
          control={control}
          title={
            value.entry.team
              ? `Leave ${value.entry.name}?`
              : `Withdraw your request to join ${value.entry.name}?`
          }
          body='You stop sharing tasks with the team and stop seeing theirs. You can ask to join again with its link.'
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
      const name = resolveFirstName(value.user);
      return (
        <ConfirmDialog
          control={control}
          title={`Remove ${name} from ${value.team.name}?`}
          body={`${name} no longer sees the team’s tasks. They can ask to join again with the team’s link.`}
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
  title = TEAMS_SECTION,
  actions = TEAM_ACTIONS,
  rights = false,
  keys = false,
  feed,
}: {
  state: ShinsaState;
  snapshot: RemoteSnapshot | null;
  failure: string | null;
  title?: string;
  actions?: TeamActions;
  rights?: boolean;
  keys?: boolean;
  feed?: TeamFeedSnapshot;
}) {
  const dialog = useDialogState<TeamsDialog>();
  const live = useTeamFeed();
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
      title={title}
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
                rights={rights}
                keys={keys}
                feed={feed ?? live}
                onDialog={dialog.show}
              />
            ))}
        </div>
      )}
      <TeamsDialogs
        dialog={dialog}
        state={state}
        snapshot={snapshot}
        actions={actions}
        onDialog={dialog.show}
      />
    </SettingsSection>
  );
}

export function TeamsSettings({ state }: { state: ShinsaState }) {
  const { snapshot, failure } = useRemoteAccess();
  const supported = useEngineFeature('teams');
  const rights = useEngineFeature('team-access');
  const keys = useEngineFeature('team-keys');
  if (!supported) return null;
  return <TeamsGroup state={state} snapshot={snapshot} failure={failure} rights={rights} keys={keys} />;
}

function MachineTeams({
  state,
  machine,
  owned,
  title,
}: {
  state: ShinsaState;
  machine: MachineAccess;
  owned: readonly MachineAccess[];
  title: string;
}) {
  const supported = useEngineFeature('teams', machine.id);
  const rights = useEngineFeature('team-access', machine.id);
  const keys = useEngineFeature('team-keys', machine.id);
  const choice = useMachines().find((candidate) => candidate.id === machine.id);
  const projectIds = Object.keys(choice?.state.projects ?? {});
  const projectKey = projectIds.join(' ');
  const scoped = React.useMemo(() => scopeStateToProjects(state, projectKey.split(' ')), [state, projectKey]);
  const actions = React.useMemo(() => createTeamActions(machine.id), [machine.id]);
  const grant = React.useMemo(() => ({ owned, currentId: machine.id }), [owned, machine.id]);
  if (!supported) return null;
  return (
    <GrantMachinesContext.Provider value={grant}>
      <TeamsGroup
        state={scoped}
        snapshot={machine.remote}
        failure={null}
        title={title}
        actions={actions}
        rights={rights}
        keys={keys}
      />
    </GrantMachinesContext.Provider>
  );
}

export function MachineTeamsSettings({
  state,
  machines,
  connecting = false,
}: {
  state: ShinsaState;
  machines: readonly MachineAccess[];
  connecting?: boolean;
}) {
  if (machines.length === 0 && connecting) {
    return (
      <SettingsSection title={TEAMS_SECTION} description={TEAMS_DESCRIPTION}>
        <SettingsCard>
          <SettingsEmpty>{TEAMS_CONNECTING}</SettingsEmpty>
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (machines.length === 0) return <HostedTeamsSettings />;
  return (
    <>
      {machines.map((machine) => (
        <MachineTeams
          key={machine.id}
          state={state}
          machine={machine}
          owned={machines}
          title={
            machines.length > 1 ? `${TEAMS_SECTION} on ${describeMachineName(machine.name)}` : TEAMS_SECTION
          }
        />
      ))}
    </>
  );
}
