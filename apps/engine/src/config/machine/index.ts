import { edgeRuntime } from '../../runtime/edge.ts';
import type { MachineConfigRead } from './schema.ts';
import { MachineConfigFile } from './service.ts';

export function readMachineConfig(path: string): MachineConfigRead {
  return edgeRuntime.runSync(MachineConfigFile.use((file) => file.read(path)));
}
