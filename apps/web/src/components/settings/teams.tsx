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
import { Truncate } from '@shinsa/ui/components/truncate';
import { type DialogControl, useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { CopyButton } from '@/components/controls/copy-button.tsx';
import { ConfirmDialog } from '@/components/overlays/confirm-dialog.tsx';
import { TeamDialog } from '@/components/teams/join-dialog.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { confirmDone, requestWithToast } from '@/lib/connection/commands.ts';
import { useRemoteAccess } from '@/lib/connection/remote-access.ts';
import { TEAM_ACTIONS, type TeamActions } from '@/lib/connection/teams.ts';
import { formatSince } from '@/lib/format/time.ts';
import { describeUserName } from '@/lib/remote/users.ts';
import { describeMemberSince } from '@/lib/remote-access.ts';
import {
  canUseTeams,
  describeJoinOutcome,
  describeTeamEntry,
  describeTeamProjects,
  describeTeamsUnavailable,
  listProjectChoices,
  needsTeamLink,
  TEAM_LINK_COPY,
  TEAMS_DESCRIPTION,
  TEAMS_SECTION,
} from '@/lib/teams/settings.ts';
import {
  SETTING_ROW,
  SETTINGS_SUBHEADING,
  SettingsBlock,
  SettingsEmpty,
  SettingsGroup,
  TOKEN_TEXT,
} from './group.tsx';
import { UserRow } from './user-row.tsx';

type TeamsDialog =
  | { kind: 'create' }
  | { kind: 'join' }
  | { kind: 'projects'; entry: RemoteTeamEntry }
  | { kind: 'link'; teamId: string; name: string; url: string | null }
  | { kind: 'leave'; entry: RemoteTeamEntry }
  | { kind: 'remove'; entry: RemoteTeamEntry }
  | { kind: 'member'; team: RemoteTeam; user: RemoteUser };

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

  async function run(act: () => Promise<unknown>, done: string) {
    setBusy(true);
    await requestWithToast(act, done);
    setBusy(false);
  }

  return (
    <Dialog {...control}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Link to join ${name}`}</DialogTitle>
          <DialogDescription>{TEAM_LINK_COPY}</DialogDescription>
        </DialogHeader>
        <div className='flex w-full min-w-0 items-center gap-1.5'>
          <Truncate className='min-w-0 flex-1 font-mono text-2xs text-fg-2'>
            {url ?? 'Making the link…'}
          </Truncate>
          {url && <CopyButton text={url} />}
        </div>
        <DialogFooter>
          <Button
            variant='secondary'
            disabled={busy || !url}
            onClick={() =>
              void run(async () => {
                await actions.removeLink(teamId);
                control.onOpenChange(false);
              }, 'The link is off.')
            }
          >
            Turn off link
          </Button>
          <Button
            variant='secondary'
            disabled={busy || !url}
            onClick={() =>
              void run(async () => setUrl((await actions.renewLink(teamId)).url), 'New link made.')
            }
          >
            Make new link
          </Button>
          <DialogClose render={<Button />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function TeamPeople({
  team,
  viewer,
  onRemove,
}: {
  team: RemoteTeam;
  viewer: string | null;
  onRemove: (user: RemoteUser) => void;
}) {
  const now = useNow();
  const owns = team.role === 'owner';
  return (
    <>
      <p className={SETTINGS_SUBHEADING}>People in the team</p>
      <UserRow user={team.owner} detail='Owner' self={owns} />
      {team.members.map((member) => (
        <UserRow
          key={member.user.id}
          user={member.user}
          detail={describeMemberSince(member, now)}
          self={member.user.login === viewer}
        >
          {owns && (
            <Button variant='secondary' size='sm' onClick={() => onRemove(member.user)}>
              Remove
            </Button>
          )}
        </UserRow>
      ))}
    </>
  );
}

function TeamBlock({
  state,
  entry,
  viewer,
  actions,
  onDialog,
}: {
  state: ShinsaState;
  entry: RemoteTeamEntry;
  viewer: string | null;
  actions: TeamActions;
  onDialog: (dialog: TeamsDialog) => void;
}) {
  const now = useNow();
  const { team } = entry;
  const owns = team?.role === 'owner';
  return (
    <SettingsBlock
      header={
        <>
          <Truncate className='min-w-0 shrink font-medium text-fg-4 text-xs'>{entry.name}</Truncate>
          <Truncate className={`${TOKEN_TEXT} min-w-0 flex-1`}>{describeTeamEntry(entry, now)}</Truncate>
          {owns && (
            <Button
              variant='secondary'
              size='sm'
              icon='IconUserAdd'
              onClick={() => onDialog({ kind: 'link', teamId: entry.id, name: entry.name, url: null })}
            >
              Join link
            </Button>
          )}
          <Button
            variant='secondary'
            size='sm'
            onClick={() => onDialog(owns ? { kind: 'remove', entry } : { kind: 'leave', entry })}
          >
            {owns ? 'Remove team' : team ? 'Leave' : 'Withdraw'}
          </Button>
        </>
      }
    >
      <div className={SETTING_ROW}>
        <span className='min-w-0 flex-1 text-fg-2 text-xs'>{describeTeamProjects(state, entry.id)}</span>
        <Button variant='secondary' size='sm' onClick={() => onDialog({ kind: 'projects', entry })}>
          Choose projects
        </Button>
      </div>
      {needsTeamLink(entry) && (
        <SettingsEmpty>
          This machine does not hold the team’s key, so it cannot show the team’s tasks. Add the team’s link
          here with Join a team.
        </SettingsEmpty>
      )}
      {team && <TeamRequests team={team} actions={actions} />}
      {team && (
        <TeamPeople
          team={team}
          viewer={viewer}
          onRemove={(user) => onDialog({ kind: 'member', team, user })}
        />
      )}
    </SettingsBlock>
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
  const projects = listProjectChoices(state);
  switch (value?.kind) {
    case 'create':
      return (
        <TeamDialog
          control={control}
          mode='create'
          projects={projects}
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
    case 'join':
      return (
        <TeamDialog
          control={control}
          mode='join'
          projects={projects}
          onSubmit={async (draft) => {
            const joined = await actions.join(state, draft.url.trim(), draft.projectIds);
            confirmDone(describeJoinOutcome(joined.status));
          }}
        />
      );
    case 'projects':
      return (
        <TeamDialog
          control={control}
          mode='projects'
          projects={projects}
          initialProjectIds={listTeamProjectIds(state, value.entry.id)}
          onSubmit={async (draft) => {
            await actions.writeProjects(state, value.entry.id, draft.projectIds);
            confirmDone('Shared projects saved.');
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
    case 'remove':
      return (
        <ConfirmDialog
          control={control}
          title={`Remove ${value.entry.name}?`}
          body='The team is removed for every member, and every view of its tasks closes. This cannot be undone.'
          action='Remove team'
          onConfirm={() =>
            void requestWithToast(() => actions.remove(value.entry.id), `${value.entry.name} is removed.`)
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
  return (
    <SettingsGroup
      title={TEAMS_SECTION}
      description={TEAMS_DESCRIPTION}
      action={
        usable ? (
          <div className='flex items-center gap-1.5'>
            <Button variant='secondary' size='sm' onClick={() => dialog.show({ kind: 'join' })}>
              Join a team
            </Button>
            <Button
              variant='secondary'
              size='sm'
              icon='IconPlusSmall'
              onClick={() => dialog.show({ kind: 'create' })}
            >
              New team
            </Button>
          </div>
        ) : undefined
      }
    >
      {!snapshot && <SettingsEmpty>{failure ?? 'Reading teams…'}</SettingsEmpty>}
      {snapshot && !usable && <SettingsEmpty>{describeTeamsUnavailable(snapshot)}</SettingsEmpty>}
      {usable && snapshot.teams.length === 0 && (
        <SettingsEmpty>
          This machine is in no team. Make one, or join one with the link a teammate sent you.
        </SettingsEmpty>
      )}
      {usable &&
        snapshot.teams.map((entry) => (
          <TeamBlock
            key={entry.id}
            state={state}
            entry={entry}
            viewer={snapshot.owner}
            actions={actions}
            onDialog={dialog.show}
          />
        ))}
      <TeamsDialogs dialog={dialog} state={state} actions={actions} onDialog={dialog.show} />
    </SettingsGroup>
  );
}

export function TeamsSettings({ state }: { state: ShinsaState }) {
  const { snapshot, failure } = useRemoteAccess();
  return <TeamsGroup state={state} snapshot={snapshot} failure={failure} />;
}
