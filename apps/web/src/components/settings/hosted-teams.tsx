import type { AccessScopes, RemoteTeam, RemoteUser } from '@shinsa/core';
import { Button } from '@shinsa/ui/components/button';
import { Truncate } from '@shinsa/ui/components/truncate';
import { useDialogState } from '@shinsa/ui/hooks/use-dialog-state';
import * as React from 'react';
import { MentionText } from '@/components/people/user-tag.tsx';
import { MemberScopesDialog, TeamScopesBlock } from '@/components/teams/scopes.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTeamPresence } from '@/hooks/use-team-presence.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeMemberSince } from '@/lib/remote-access.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { listHostedTeams } from '@/lib/teams/hosted.ts';
import { describePresence } from '@/lib/teams/presence.ts';
import { hasOwnScopes } from '@/lib/teams/scopes.ts';
import {
  describeHostedTeam,
  describeHostedTeamsNotice,
  describePeopleCount,
  type HostedTeam,
  type HostedTeams,
  showsKeyNote,
  replaceHostedTeam,
  listTeamPeople,
  TEAM_KEY_MISSING,
  TEAMS_DESCRIPTION,
  TEAMS_ON_MACHINE_NOTE,
  TEAMS_SECTION,
} from '@/lib/teams/settings.ts';
import { FoldingBlock, SETTING_ROW, SettingsCard, SettingsEmpty, SettingsSection } from './group.tsx';
import { TeamMachines } from './team-machines.tsx';
import { UserRow } from './user-row.tsx';

type UpdateScopes = (teamId: string, userId: string | null, scopes: AccessScopes | null) => Promise<unknown>;

function TeamPeople({
  team,
  viewerId,
  onScopes,
}: {
  team: RemoteTeam;
  viewerId: string | null;
  onScopes: ((user: RemoteUser) => void) | null;
}) {
  const now = useNow();
  const presence = useTeamPresence(team.id);
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'people')}
      title='People'
      detail={describePeopleCount(team)}
    >
      {listTeamPeople(team, '').map(({ user, member }) => {
        const self = user.id === viewerId;
        const seen = self ? null : (presence.get(user.id) ?? null);
        const base = member ? describeMemberSince(member, now) : 'Owner';
        const parts = [
          seen ? describePresence(seen, now) : null,
          base,
          hasOwnScopes(team, user.id) ? 'Own scopes' : null,
        ];
        return (
          <UserRow
            key={user.id}
            user={user}
            detail={parts.filter((part) => part !== null).join(' · ')}
            self={self}
            presence={seen}
          >
            {onScopes && member && (
              <Button variant='secondary' size='sm' onClick={() => onScopes(user)}>
                Scopes
              </Button>
            )}
          </UserRow>
        );
      })}
    </FoldingBlock>
  );
}

function HostedTeamCard({
  entry,
  viewerId,
  onUpdate,
  onScopes,
}: {
  entry: HostedTeam;
  viewerId: string | null;
  onUpdate: UpdateScopes | null;
  onScopes: ((user: RemoteUser) => void) | null;
}) {
  const now = useNow();
  const { team } = entry;
  return (
    <SettingsCard>
      <div className={SETTING_ROW}>
        <div className='flex min-w-0 flex-1 flex-col'>
          <Truncate className='text-xs font-medium text-fg-4'>{team.name}</Truncate>
          <Truncate className='text-2xs text-fg-2'>
            <MentionText mention={describeHostedTeam(team, now)} />
          </Truncate>
          {showsKeyNote(entry) && <p className='text-2xs text-pretty text-fg-2'>{TEAM_KEY_MISSING}</p>}
        </div>
      </div>
      <TeamMachines team={team} />
      <TeamScopesBlock team={team} onUpdate={team.role === 'owner' ? onUpdate : null} />
      <TeamPeople
        team={team}
        viewerId={viewerId}
        onScopes={team.role === 'owner' && onUpdate ? onScopes : null}
      />
    </SettingsCard>
  );
}

export function HostedTeamsGroup({
  teams,
  failure,
  onUpdate = null,
}: {
  teams: HostedTeams | null;
  failure: string | null;
  onUpdate?: UpdateScopes | null;
}) {
  const dialog = useDialogState<{ teamId: string; user: RemoteUser }>();
  const open = dialog.value;
  const dialogTeam = open ? teams?.teams.find((entry) => entry.team.id === open.teamId)?.team : undefined;
  return (
    <SettingsSection title={TEAMS_SECTION} description={`${TEAMS_DESCRIPTION} ${TEAMS_ON_MACHINE_NOTE}`}>
      {!failure && teams && teams.teams.length > 0 ? (
        <div className='flex flex-col gap-2'>
          {teams.teams.map((entry) => (
            <HostedTeamCard
              key={entry.team.id}
              entry={entry}
              viewerId={teams.viewerId}
              onUpdate={onUpdate}
              onScopes={(user) => dialog.show({ teamId: entry.team.id, user })}
            />
          ))}
        </div>
      ) : (
        <SettingsCard>
          <SettingsEmpty>{describeHostedTeamsNotice(teams, failure)}</SettingsEmpty>
        </SettingsCard>
      )}
      {onUpdate && open && dialogTeam && (
        <MemberScopesDialog control={dialog.control} team={dialogTeam} user={open.user} onUpdate={onUpdate} />
      )}
    </SettingsSection>
  );
}

export function HostedTeamsSettings() {
  const services = React.useContext(RemoteServicesContext);
  const [teams, setTeams] = React.useState<HostedTeams | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!services) return;
    let live = true;
    listHostedTeams(services).then(
      (next) => {
        if (live) setTeams(next);
      },
      (error: unknown) => {
        if (live) setFailure((error as Error).message);
      }
    );
    return () => {
      live = false;
    };
  }, [services]);
  const update = React.useCallback<UpdateScopes>(
    async (teamId, userId, scopes) => {
      if (!services) return;
      const team = await services.dashboard.updateTeamScopes(teamId, userId, scopes);
      setTeams((current) => (current ? replaceHostedTeam(current, team) : current));
    },
    [services]
  );
  return <HostedTeamsGroup teams={teams} failure={failure} onUpdate={services ? update : null} />;
}
