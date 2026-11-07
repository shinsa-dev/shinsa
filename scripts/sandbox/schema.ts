import { join, resolve } from 'node:path';
import { Duration, Schedule, Schema } from 'effect';
import type { Terminals } from '../../apps/engine/src/terminals/index.ts';
import type { Engine } from '../../apps/engine/test/helpers/engine.ts';
import { REMOTE_PATHS, type RemoteUser } from '../../packages/core/src/index.ts';
import type { StartedRemote } from '../kit/remote.ts';

export const ROOT = resolve(import.meta.dirname, '../..');

export const PORT = Number(Bun.env.PORT ?? 5195);

export const HOST = '127.0.0.1';

export const ORIGIN = `http://${HOST}:${PORT}`;

export const PREVIEW_ZONE = `http://localhost:${PORT}`;

export const SANDBOX_DIR = Bun.env.SHINSA_SANDBOX_DIR ?? join('/tmp', `shinsa-sandbox-${PORT}`);

export const REMOTE_WEB = join(ROOT, 'apps/web/dist-remote');

export const LOCAL_WEB = join(ROOT, 'apps/web/dist');

export const USER: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

export const GUEST: RemoteUser = { id: 'preview-guest', login: 'kai', name: 'Kai Lane', avatarUrl: null };

export const TEAMMATE: RemoteUser = { id: '2', login: 'kai', name: 'Kai Tanaka', avatarUrl: null };

export const AS_COOKIE = 'shinsa_preview_as';

export const SANDBOX_PATH = '/sandbox';

export const SERVICE_TOGGLE = new RegExp(`^${SANDBOX_PATH}/service/(start|stop)$`);

export const TEAMMATE_TOGGLE = new RegExp(`^${SANDBOX_PATH}/teammate/(online|offline)$`);

export const ENROLL = new RegExp(`^${SANDBOX_PATH}/enroll/([a-z]+)$`);

export const HANDOFF_FRESH = new RegExp(`^${SANDBOX_PATH}/handoff/([A-Z]+-\\d+)$`);

export const SIGN_IN_AS = new RegExp(`^${SANDBOX_PATH}/as/([a-z]+)$`);

export const TUNNEL = new RegExp(`^${SANDBOX_PATH}/tunnel/([a-z]+)(/share|/team)?$`);

export const SHARE_CONNECT = new RegExp(`^${REMOTE_PATHS.shares}/([a-z]+)/connect$`);

export const TEAM_INVITE = 'preview-team-invite';

export const GIGABYTE = 1024 ** 3;

export interface SeedTask {
  request: string;
  title: string;
  branch: string;
  owner?: RemoteUser;
}

export const LAPTOP_TASKS: SeedTask[] = [
  {
    request: 'Add a dark mode toggle to the marketing site header',
    title: 'Add a dark mode toggle',
    branch: 'feat/dark-mode-toggle',
    owner: USER,
  },
  {
    request: 'Find why the nightly backup job skips Sundays',
    title: 'Find why backups skip Sundays',
    branch: 'fix/sunday-backups',
    owner: TEAMMATE,
  },
  {
    request: 'Compare three charting libraries for the stats page and recommend one',
    title: 'Compare charting libraries',
    branch: 'docs/charting-libraries',
  },
];

export const TEAMMATE_TASKS: SeedTask[] = [
  {
    request: 'Let a paywall be duplicated from its menu, with its products and copy',
    title: 'Duplicate a paywall from its menu',
    branch: 'feat/duplicate-paywall',
  },
  {
    request: 'Find why paywall previews flicker when the theme changes',
    title: 'Find why previews flicker on theme change',
    branch: 'fix/preview-flicker',
  },
  {
    request: 'Move the paywall list to the new table component',
    title: 'Move the paywall list to the new table',
    branch: 'refactor/paywall-table',
  },
];

export const SEEDED_MESSAGES = [
  'Can you keep the old export working for one more release?',
  'Looks good so far. Please also cover the empty state.',
];

export interface PreviewLoad {
  cores: number;
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  diskFreeGb: number;
}

export const PREVIEW_LOADS: Record<string, PreviewLoad> = {
  studio: { cores: 12, cpuPercent: 46, memoryUsedGb: 21, memoryTotalGb: 32, diskFreeGb: 180 },
  laptop: { cores: 8, cpuPercent: 12, memoryUsedGb: 6, memoryTotalGb: 16, diskFreeGb: 64 },
};

export interface SeedProject {
  repo: string;
  project: string;
  tasks: SeedTask[];
}

export interface Machine {
  id: string;
  name: string;
  remote: StartedRemote;
  port: number;
  connectKey: string;
  publicKey: string;
}

export interface PreviewShare {
  url: string;
  label: string;
  handle: string;
  port: number;
}

export interface ServicePreview {
  url: string;
  privateUrl: string | null;
  handle: string;
  port: number;
}

export interface SharedService {
  engine: Engine;
  terminals: Terminals['Service'];
  serviceId: string;
  taskId: string;
}

export interface SandboxSection {
  title: string;
  links: { label: string; url: string }[];
}

export interface SandboxPageModule {
  serializeSandboxPage: (sections: SandboxSection[], stylesheet: string) => string;
}

export interface TunnelData {
  machine: Machine;
  path: string;
  upstream: WebSocket | null;
  pending: (string | Uint8Array)[];
  headers?: Record<string, string>;
}

export class SandboxFailed extends Schema.TaggedError<SandboxFailed, { readonly brand: unique symbol }>()(
  'SandboxFailed',
  { message: Schema.String }
) {}

export class SandboxBodyInvalid extends Schema.TaggedError<
  SandboxBodyInvalid,
  { readonly brand: unique symbol }
>()('SandboxBodyInvalid', { message: Schema.String }) {}

export class PreviewPending extends Schema.TaggedError<PreviewPending, { readonly brand: unique symbol }>()(
  'PreviewPending',
  {}
) {}

export const TokenBody = Schema.Struct({ token: Schema.optional(Schema.String) });

export const UserBody = Schema.Struct({ userId: Schema.optional(Schema.String) });

export const InstanceBody = Schema.Struct({ instanceId: Schema.optional(Schema.String) });

export const PREVIEW_SHARE_POLL = Schedule.spaced('100 millis').pipe(
  Schedule.upTo({ times: 49 }),
  Schedule.setInputType<{ readonly _tag: string }>(),
  Schedule.while(({ input }) => input._tag === 'PreviewPending')
);

export const HANDOFF_LINK_TIMEOUT = Duration.seconds(30);

export const SEED_TIMEOUT = Duration.minutes(5);

export const GIT_TIMEOUT = Duration.seconds(30);
