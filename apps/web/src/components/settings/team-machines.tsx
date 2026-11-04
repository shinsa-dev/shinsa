import type { RemoteTeam } from '@shinsa/core';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { MentionText } from '@/components/people/user-tag.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTeamFeed } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { listTeamMachineRows, type TeamMachineTone } from '@/lib/teams/settings.ts';
import { FoldingBlock, SETTING_ROW, SettingsEmpty } from './group.tsx';

const MACHINE_TONE_TEXT: Record<TeamMachineTone, string> = {
  online: TONE_TEXT.green,
  warning: TONE_TEXT.orange,
  quiet: 'text-fg-2',
};

export function TeamMachines({ team, keyless }: { team: RemoteTeam; keyless?: ReadonlySet<string> }) {
  const now = useNow();
  const feed = useTeamFeed();
  const rows = listTeamMachineRows(team, now, feed, keyless);
  return (
    <FoldingBlock
      persistId={createDisclosureId('settings', 'teams', team.id, 'machines')}
      title='Machines'
      detail={String(rows.length)}
      startsOpen
    >
      {rows.length === 0 && (
        <SettingsEmpty>No one in this team has turned on remote access yet.</SettingsEmpty>
      )}
      {rows.map(({ machine, tone, status, owner }) => (
        <div key={machine.id} className={SETTING_ROW}>
          <div className='flex min-w-0 flex-1 flex-col'>
            <div className='flex min-w-0 items-center gap-1.5 text-xs'>
              <Truncate className='font-medium text-fg-4'>{machine.name}</Truncate>
              <span className={cn('shrink-0', MACHINE_TONE_TEXT[tone])}>{status}</span>
            </div>
            {owner && (
              <Truncate className='text-2xs text-fg-2'>
                <MentionText mention={['Owned by ', { user: owner }]} />
              </Truncate>
            )}
          </div>
        </div>
      ))}
    </FoldingBlock>
  );
}
