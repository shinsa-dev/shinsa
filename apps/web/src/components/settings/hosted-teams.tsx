import type { RemoteTeam } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { MentionText } from '@/components/people/user-tag.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { describeMemberSince } from '@/lib/remote-access.ts';
import { RemoteServicesContext } from '@/lib/remote/services.ts';
import { listHostedTeams } from '@/lib/teams/hosted.ts';
import {
  describeHostedTeam,
  describeHostedTeamsNotice,
  describePeopleCount,
  type HostedTeam,
  type HostedTeams,
  listTeamMachineRows,
  listTeamPeople,
  TEAM_KEY_MISSING,
  TEAMS_DESCRIPTION,
  TEAMS_ON_MACHINE_NOTE,
  TEAMS_SECTION,
} from '@/lib/teams/settings.ts';
import { FoldingBlock, SETTING_ROW, SettingsCard, SettingsEmpty, SettingsSection } from './group.tsx';
import { UserRow } from './user-row.tsx';

function TeamMachines({ team }: { team: RemoteTeam }) {
  const now = useNow();
  const rows = listTeamMachineRows(team, now);
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'machines')}
      title='Machines'
      detail={String(rows.length)}
      startsOpen
    >
      {rows.length === 0 && <SettingsEmpty>No machine in this team is on yet.</SettingsEmpty>}
      {rows.map(({ machine, status, owner }) => (
        <div key={machine.id} className={SETTING_ROW}>
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex min-w-0 items-center gap-1.5 text-xs leading-4'>
              <Truncate className='font-medium text-fg-4'>{machine.name}</Truncate>
              <span className={cn('shrink-0', machine.online ? TONE_TEXT.green : 'text-fg-2')}>{status}</span>
            </div>
            {owner && (
              <Truncate className='text-2xs leading-4 text-fg-2'>
                <MentionText mention={['Owned by ', { user: owner }]} />
              </Truncate>
            )}
          </div>
        </div>
      ))}
    </FoldingBlock>
  );
}

function TeamPeople({ team, viewerId }: { team: RemoteTeam; viewerId: string | null }) {
  const now = useNow();
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'people')}
      title='People'
      detail={describePeopleCount(team)}
    >
      {listTeamPeople(team, '').map(({ user, member }) => (
        <UserRow
          key={user.id}
          user={user}
          detail={member ? describeMemberSince(member, now) : 'Owner'}
          self={user.id === viewerId}
        />
      ))}
    </FoldingBlock>
  );
}

function HostedTeamCard({ entry, viewerId }: { entry: HostedTeam; viewerId: string | null }) {
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
        </div>
      </div>
      {!entry.hasKey && (
        <div className={cn(SETTING_ROW, 'gap-2')}>
          <Icon name='IconKey1' size='sm' className='shrink-0 text-fg-2' />
          <p className='min-w-0 flex-1 text-2xs text-pretty text-fg-2'>{TEAM_KEY_MISSING}</p>
        </div>
      )}
      <TeamMachines team={team} />
      <TeamPeople team={team} viewerId={viewerId} />
    </SettingsCard>
  );
}

export function HostedTeamsGroup({ teams, failure }: { teams: HostedTeams | null; failure: string | null }) {
  return (
    <SettingsSection title={TEAMS_SECTION} description={`${TEAMS_DESCRIPTION} ${TEAMS_ON_MACHINE_NOTE}`}>
      {!failure && teams && teams.teams.length > 0 ? (
        <div className='flex flex-col gap-2'>
          {teams.teams.map((entry) => (
            <HostedTeamCard key={entry.team.id} entry={entry} viewerId={teams.viewerId} />
          ))}
        </div>
      ) : (
        <SettingsCard>
          <SettingsEmpty>{describeHostedTeamsNotice(teams, failure)}</SettingsEmpty>
        </SettingsCard>
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
  return <HostedTeamsGroup teams={teams} failure={failure} />;
}
