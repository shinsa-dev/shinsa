import { Switch } from '@shinsa/ui/components/switch';
import { Hint } from '@/components/overlays/hint.tsx';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { useSettings } from '@/lib/connection/selectors.ts';
import { useMachines } from '@/lib/connection/socket.ts';
import {
  describeSharedMachineSaved,
  resolveSharedPatch,
  SHARED_MACHINE_HINT,
  SHARED_MACHINE_TITLE,
} from '@/lib/shared-machine.ts';
import { SettingRow } from './group.tsx';

function useSharedMachine(machineId: string | null) {
  const settings = useSettings();
  const machine = useMachines().find((candidate) => candidate.id === machineId);
  if (machine) return machine.state.settings.sharedMachine === true;
  return settings?.sharedMachine === true;
}

export function SharedMachineRow({ machineId }: { machineId: string | null }) {
  const shared = useSharedMachine(machineId);
  return (
    <SettingRow
      title={
        <Hint label={SHARED_MACHINE_HINT}>
          <span className='cursor-default truncate'>{SHARED_MACHINE_TITLE}</span>
        </Hint>
      }
    >
      <Switch
        checked={shared}
        aria-label={SHARED_MACHINE_TITLE}
        onCheckedChange={(next) =>
          void sendCommandWithToast(
            { type: 'settings.change', patch: resolveSharedPatch(next) },
            describeSharedMachineSaved(next),
            machineId
          )
        }
      />
    </SettingRow>
  );
}
