import type { AgentProviderInfo, Changelog, GuestActor } from '@shinsa/core';
import {
  BodyTooLarge,
  ConnectRefused,
  ContentTypeInvalid,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  RequestFailed,
  RequestForbidden,
  RouteNotFound,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import { Context, Schema } from 'effect';
import type { Accounts } from '../accounts/index.ts';
import type { ModelSource } from '../agents/index.ts';
import type { Transcripts } from '../agents/transcripts/index.ts';
import type { ServerConfig } from '../config/index.ts';
import type { Extensions } from '../extensions/index.ts';
import type { EngineRestarter, ServerInstance } from '../instance/index.ts';
import type { Onboarding } from '../onboarding/index.ts';
import type { Remote } from '../remote/index.ts';
import type { PlacementAsker } from '../remote/placement.ts';
import type { PreviewLinks } from '../remote/previews.ts';
import type { ShareLinks } from '../remote/shares.ts';
import type { TeamFeeds } from '../remote/team-feeds.ts';
import type { Teams } from '../remote/teams.ts';
import type { LoginResolver, RootSource } from '../repos/index.ts';
import type { ResourceMonitor } from '../resources/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { Schedules } from '../schedules/index.ts';
import type { CommandResult } from '../shell/index.ts';
import type { Slack } from '../slack/index.ts';
import type { EvidenceStore } from '../store/index.ts';
import type { ServiceRefiner, Terminals } from '../terminals/index.ts';
import type { Classifier } from '../triage/message.ts';
import type { Versions } from '../versions/index.ts';
import type { Workspaces } from '../workspaces/index.ts';

const REQUEST_VIAS = ['local', 'tunnel', 'channel'] as const;

type RequestVia = (typeof REQUEST_VIAS)[number];

export interface RequestSourceShape {
  readonly via: RequestVia;
  readonly guest: GuestActor | null;
  readonly userId: string | null;
}

export const RequestSource = Context.Reference<RequestSourceShape>('shinsa/engine/http/RequestSource', {
  defaultValue: () => ({ via: 'local', guest: null, userId: null }),
});

export const PORT_TAKEN = 'EADDRINUSE';

export class PortInUse extends Schema.TaggedError<PortInUse, { readonly brand: unique symbol }>()(
  'PortInUse',
  {
    message: Schema.String,
  }
) {}

export type JsonObject = Record<string, unknown>;

export type Launcher = (command: string[], cwd: string) => Promise<CommandResult>;

interface ProviderCatalog {
  listProviders: () => Promise<AgentProviderInfo[]>;
}

export interface HttpContext {
  engine: Engine;
  remote?: Remote;
  shares?: ShareLinks;
  teams?: Teams;
  teamFeeds?: TeamFeeds;
  previews?: PreviewLinks;
  slack?: Slack;
  config: ServerConfig;
  instance?: ServerInstance;
  evidence: EvidenceStore;
  models: ModelSource;
  providers?: ProviderCatalog;
  onboarding: Onboarding;
  launch?: Launcher;
  accounts?: Accounts;
  schedules?: Schedules;
  transcripts: Transcripts;
  extensions?: Extensions;
  versions?: Versions;
  changelog?: Changelog;
  roots?: RootSource;
  resolveLogin?: LoginResolver;
  classify?: Classifier;
  place?: PlacementAsker;
  workspaces?: Workspaces;
  restarter?: EngineRestarter;
  terminals?: Terminals;
  refiner?: ServiceRefiner;
  resources?: Pick<ResourceMonitor, 'subscribe' | 'snapshot'>;
}

export type HttpServicesShape = HttpContext;

export const FIXED_FAILURES = {
  RouteNotFound,
  RequestForbidden,
  ContentTypeInvalid,
  BodyTooLarge,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  ScopeRefused,
  ConnectRefused,
} as const;

export const IngressFailure = Schema.Union([
  RouteNotFound,
  RequestForbidden,
  ContentTypeInvalid,
  BodyTooLarge,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  ScopeRefused,
  ConnectRefused,
  RequestFailed,
]);

export type IngressFailure = typeof IngressFailure.Type;

export const READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

export const BODY_INVALID = 'body_invalid';

export const BODY_NOT_JSON = 'The request body is not valid JSON.';

export const BODY_NOT_OBJECT = 'The request body must be an object.';

export const REQUEST_FAILED = 'request_failed';

export const BROWSER_ONLY = 'browser_only';
