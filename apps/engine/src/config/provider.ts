import { ConfigProvider } from 'effect';
import type { MachineConfig } from './machine/schema.ts';
import type { Env } from './schema.ts';

export function createConfigProvider(env: Env, machine: MachineConfig) {
  const file = ConfigProvider.fromUnknown({
    SHINSA_PORT: machine.port,
    SHINSA_HOST: machine.hostname,
    SHINSA_EDITOR: machine.editor,
    SHINSA_TERMINAL: machine.terminal,
  });
  return ConfigProvider.orElse(ConfigProvider.fromEnvRecord(env), file);
}
