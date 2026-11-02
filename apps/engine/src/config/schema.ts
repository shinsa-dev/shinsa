import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN } from '@shinsa/core';
import { Config, Schema } from 'effect';

export type Env = Record<string, string | undefined>;

export const MachineText = Schema.Trim.check(Schema.isNonEmpty());

export const MachineRoots = Schema.Array(MachineText);

export const MAX_PORT = 65_535;

export const MachinePort = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_PORT }));

export const MachineTime = Schema.Finite.check(Schema.isGreaterThan(0));

export const MachineConfig = Schema.Struct({
  version: Schema.Literal(1),
  roots: Schema.mutable(MachineRoots),
  onboardedAt: Schema.NullOr(MachineTime),
  port: Schema.NullOr(MachinePort),
  hostname: Schema.NullOr(MachineText),
  editor: Schema.NullOr(MachineText),
  terminal: Schema.NullOr(MachineText),
});
export type MachineConfig = typeof MachineConfig.Type;

export type MachineField = Exclude<keyof MachineConfig, 'version'>;

export const MACHINE_FIELD_PROBLEMS: Record<MachineField, string> = {
  roots: 'roots must be a list of folders; it was ignored.',
  onboardedAt: 'onboardedAt must be a time; it was ignored.',
  port: 'port must be a port number; it was ignored.',
  hostname: 'hostname must be text; it was ignored.',
  editor: 'editor must be text; it was ignored.',
  terminal: 'terminal must be text; it was ignored.',
};

export const NOT_AN_OBJECT_PROBLEM = 'The file is not a JSON object.';

export interface MachineConfigRead {
  config: MachineConfig;
  problems: string[];
  unreadable: boolean;
}

export const WholeNumberText = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0)
);

export class SettingInvalid extends Schema.TaggedError<SettingInvalid, { readonly brand: unique symbol }>()(
  'SettingInvalid',
  { key: Schema.String, message: Schema.String }
) {}

export const DEFAULT_HOSTNAME = '127.0.0.1';

export const LOOPBACK_HOSTS = ['localhost', DEFAULT_HOSTNAME, '[::1]'];

export const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export const HOSTNAME_SETTING = Config.String('SHINSA_HOST').pipe(Config.withDefault(DEFAULT_HOSTNAME));

export const ENGINE_SETTINGS = Config.all({
  hostname: HOSTNAME_SETTING,
  worktreesDir: Config.option(Config.String('SHINSA_WORKTREES_DIR')),
  pluginDir: Config.option(Config.String('SHINSA_PLUGIN_DIR')),
  webDir: Config.option(Config.String('SHINSA_WEB_DIR')),
  inspect: Config.String('SHINSA_INSPECT').pipe(Config.withDefault('')),
  editor: Config.option(Config.String('SHINSA_EDITOR')),
  terminal: Config.String('SHINSA_TERMINAL').pipe(Config.withDefault('Terminal')),
  remoteOrigin: Config.String('SHINSA_REMOTE_ORIGIN').pipe(Config.withDefault(REMOTE_APP_ORIGIN)),
  previewOrigin: Config.String('SHINSA_PREVIEW_ORIGIN').pipe(Config.withDefault(PREVIEW_ORIGIN)),
});

export const RETRY_DEFAULTS = {
  SHINSA_SETTLE_DELAY_MS: 15_000,
  SHINSA_PUSH_RETRY_MS: 30_000,
  SHINSA_OVERLOAD_RETRY_MS: 15_000,
};

export const INSPECT_ON = '1';

export const DATABASE_FILE = 'shinsa.sqlite';

export const NEVER_INDEX_MARKER = '.metadata_never_index';

export const BACKUP_EXCLUSION = {
  name: 'com.apple.metadata:com_apple_backup_excludeItem',
  value:
    '62706c69737430305f1011636f6d2e6170706c652e6261636b75706408000000000000010100000000000000010000000000000000000000000000001c',
};

export interface ServerAddress {
  hostname: string;
  port: number;
}

export interface ServerConfig extends ServerAddress {
  home: string;
  configPath: string;
  dataDir: string;
  databasePath: string;
  worktreesDir: string;
  checkBasesDir: string;
  scratchDir: string;
  cachesDir: string;
  evidenceDir: string;
  attachmentsDir: string;
  transcriptsDir: string;
  pluginDir: string;
  webDir: string;
  allowedHosts: string[];
  userHome: string;
  machine: MachineConfigRead;
  roots: string[];
  inspect: boolean;
  simulateMissing: string[];
  editor: string | null;
  terminal: string;
  settleDelayMs: number;
  pushRetryMs: number;
  overloadRetryMs: number;
  remoteOrigin: string;
  previewOrigin: string;
}
