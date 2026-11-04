import type { Layer } from 'effect';
import type {
  IdleReleaseOptions,
  ModelSource,
  NoticeListener,
  Providers,
  RejectionHandler,
  SessionStarter,
} from '../agents/index.ts';
import type { FetchLike } from '../extensions/oauth/schema.ts';
import type { Env } from '../extensions/schema.ts';
import type { AccountSource } from '../onboarding/index.ts';
import type { TunnelConnectorLayer } from '../remote/connector/schema.ts';
import type { PlacementAsker } from '../remote/placement/service.ts';
import type { Discoverer, LoginResolver } from '../repos/index.ts';
import type { ClockTimings } from '../runtime/clock/schema.ts';
import type { Shell } from '../shell/service.ts';
import type { TerminalPty } from '../terminals/pty/service.ts';
import type { TriageResolver } from '../triage/index.ts';
import type { ProgramInstalls } from '../versions/installs/service.ts';
import type { NpmRegistry } from '../versions/registry/service.ts';
import type { UpdaterRunner } from '../versions/updater/service.ts';

export interface ShinsaOptions {
  startSession?: SessionStarter;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  triage?: TriageResolver;
  place?: PlacementAsker['Service'];
  resolveLogin?: LoginResolver;
  providers?: Providers['Service'];
  models?: ModelSource;
  discover?: Discoverer;
  accounts?: AccountSource;
  accountLayer?: Layer.Layer<Shell | TerminalPty>;
  scheduleClock?: ClockTimings;
  timeZone?: string;
  idle?: IdleReleaseOptions;
  extensions?: { env?: Env; fetch?: FetchLike };
  versions?: Layer.Layer<ProgramInstalls | NpmRegistry | UpdaterRunner>;
  remoteConnector?: TunnelConnectorLayer;
  byService?: boolean;
  exit?: (code: number) => void;
}
