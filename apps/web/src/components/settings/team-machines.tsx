import type { RemoteTeam, TeamFeedSnapshot } from '@shinsa/core';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import { Hint } from '@/components/overlays/hint.tsx';
import { MentionText } from '@/components/people/user-tag.tsx';
import { useNow } from '@/hooks/use-now.ts';
import { useTeamFeed } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { createDisclosureId } from '@/lib/preferences/disclosure.ts';
import { SHARE_MACHINE_HINT, SHARED_LABEL } from '@/lib/shared-machine.ts';
import { listTeamMachineRows, type TeamMachineTone } from '@/lib/teams/settings.ts';
import { FoldingBlock, SETTING_ROW, SettingsEmpty } from './group.tsx';

const MACHINE_TONE_TEXT: Record<TeamMachineTone, string> = {
  online: TONE_TEXT.green,
  warning: TONE_TEXT.orange,
  quiet: 'text-fg-2',
};

export interface MachineShare {
  instanceId: string;
  shared: boolean;
  onChange: (shared: boolean, name: string) => void;
}

function ShareSwitch({ team, name, share }: { team: RemoteTeam; name: string; share: MachineShare }) {
  return (
    <Hint label={SHARE_MACHINE_HINT}>
      <span className='inline-flex w-fit shrink-0 items-center gap-2 text-2xs text-fg-2'>
        {SHARED_LABEL}
        <Switch
          checked={share.shared}
          aria-label={`Share ${name} with ${team.name}`}
          onCheckedChange={(shared) => share.onChange(shared, name)}
        />
      </span>
    </Hint>
  );
}

export function TeamMachines({
  team,
  keyless,
  feed,
  share = null,
}: {
  team: RemoteTeam;
  keyless?: ReadonlySet<string>;
  feed?: TeamFeedSnapshot;
  share?: MachineShare | null;
}) {
  const now = useNow();
  const live = useTeamFeed();
  const rows = listTeamMachineRows(team, now, feed ?? live, keyless);
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
          {share?.instanceId === machine.id && <ShareSwitch team={team} name={machine.name} share={share} />}
        </div>
      ))}
    </FoldingBlock>
  );
}
