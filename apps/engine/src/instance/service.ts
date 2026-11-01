type Env = Record<string, string | undefined>;

export const SERVICE_MARKER = 'SHINSA_SERVICE';

export const SERVICE_CARRIED_ENV = [
  'SHINSA_HOME',
  'SHINSA_DATA_DIR',
  'XDG_CONFIG_HOME',
  'SHINSA_PORT',
  'SHINSA_HOST',
];

export function isStartedByService(env: Env) {
  return env[SERVICE_MARKER] === '1';
}

export interface ServiceResult {
  ok: boolean;
  output: string;
}

export type ServiceRunner = (args: string[]) => Promise<ServiceResult>;

export interface EngineService {
  manager: 'launchd' | 'systemd';
  revivesKilled: boolean;
  prepare: () => Promise<string | null>;
  assertInstalled: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  kill: () => Promise<void>;
  restart: () => Promise<void>;
  kick: () => Promise<boolean>;
}

export async function runServiceOrThrow(name: string, run: ServiceRunner, args: string[]) {
  const result = await run(args);
  if (!result.ok) throw new Error(`${name} ${args[0]} failed: ${result.output.trim() || 'no output'}`);
}
