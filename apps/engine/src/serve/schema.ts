import type { AccountsOptions } from '../accounts/index.ts';
import type {
  IdleCompactionOptions,
  IdleReleaseOptions,
  ModelSource,
  NoticeListener,
  ProviderRegistry,
  RejectionHandler,
  SessionStarter,
} from '../agents/index.ts';
import type { ExtensionsOptions } from '../extensions/index.ts';
import type { AccountSource, CommandRunner } from '../onboarding/index.ts';
import type { TunnelConnectorLayer } from '../remote/index.ts';
import type { PlacementAsker } from '../remote/placement.ts';
import type { Discoverer, LoginResolver } from '../repos/index.ts';
import type { Engine, StateClockOptions } from '../runtime/index.ts';
import type { TerminalsOptions } from '../terminals/index.ts';
import type { TriageResolver } from '../triage/index.ts';
import type { Classifier } from '../triage/message.ts';
import type { VersionsOptions } from '../versions/index.ts';

export interface ShinsaOptions {
  startSession?: SessionStarter;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  triage?: TriageResolver;
  classify?: Classifier;
  place?: PlacementAsker;
  resolveLogin?: LoginResolver;
  providers?: ProviderRegistry;
  models?: ModelSource;
  discover?: Discoverer;
  runPrerequisite?: CommandRunner;
  accounts?: AccountSource;
  accountOptions?: Omit<AccountsOptions, 'engine' | 'config'>;
  scheduleClock?: StateClockOptions;
  timeZone?: string;
  idle?: IdleReleaseOptions;
  compaction?: IdleCompactionOptions;
  extensions?: Pick<ExtensionsOptions, 'check' | 'env' | 'fetch'>;
  versions?: VersionsOptions;
  terminals?: Pick<TerminalsOptions, 'spawn' | 'readForeground' | 'env'>;
  remoteConnector?: TunnelConnectorLayer;
  openRemoteUrl?: (url: string) => Promise<void>;
  byService?: boolean;
  exit?: (code: number) => void;
}

export interface Shinsa {
  url: string;
  engine: Engine;
  stop: () => Promise<void>;
}
