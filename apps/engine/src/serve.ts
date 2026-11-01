import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  Accounts,
  type AccountsOptions,
  createOnboardingAccounts,
  UsageResumeClock,
} from './accounts/index.ts';
import {
  type IdleCompactionOptions,
  type IdleReleaseOptions,
  listDefaultProviders,
  type ModelSource,
  type NoticeListener,
  ProviderRegistry,
  type RejectionHandler,
  RunSupervisor,
  type SessionStarter,
  SilenceWatch,
  Transcripts,
} from './agents/index.ts';
import { createQuickCalls } from './agents/quick/index.ts';
import { Briefings } from './briefing/index.ts';
import { ConfigStore, prepareDataDir, type ServerConfig } from './config/index.ts';
import { EunoeServer } from './eunoe/index.ts';
import { Extensions, type ExtensionsOptions } from './extensions/index.ts';
import { resolveServerUrl, startServer } from './http/index.ts';
import {
  acquireDataDirLock,
  BUNDLE,
  createServiceRestarter,
  resolveServerInstance,
  type ServerInstance,
} from './instance/index.ts';
import { describeError, log } from './log/index.ts';
import { type AccountSource, type CommandRunner, Onboarding } from './onboarding/index.ts';
import { createProjectChanges } from './projects/routes.ts';
import {
  ControlClient,
  createInstalledConnector,
  createUrlOpener,
  REMOTE_FILE,
  Remote,
  resolveMachineName,
  type StartConnector,
} from './remote/index.ts';
import { createPlacementAsker, type PlacementAsker } from './remote/placement.ts';
import { ShareClock } from './remote/share-clock.ts';
import { Shares } from './remote/shares.ts';
import {
  createDiscoverer,
  createLoginResolver,
  type Discoverer,
  type LoginResolver,
  Roots,
} from './repos/index.ts';
import {
  EffectRunner,
  Engine,
  MonitorClock,
  type StateClockOptions,
  WatchdogClock,
} from './runtime/index.ts';
import { Schedules } from './schedules/index.ts';
import { createWatchWriter } from './schedules/suggest.ts';
import { SecretStore } from './secrets/index.ts';
import { Slack } from './slack/index.ts';
import {
  ATTACHMENT_REQUEST_LIMIT_BYTES,
  EventLog,
  EvidenceStore,
  resolveStateVersion,
} from './store/index.ts';
import { ServiceRefiner, Terminals, type TerminalsOptions } from './terminals/index.ts';
import { MessageInbox } from './triage/inbox.ts';
import { resolveTriage, type TriageResolver } from './triage/index.ts';
import {
  type Classifier,
  createClassifier,
  createCommandRouter,
  resolveRoundRepository,
} from './triage/message.ts';
import { Versions, type VersionsOptions } from './versions/index.ts';

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
  remoteConnect?: StartConnector;
  openRemoteUrl?: (url: string) => Promise<void>;
  byService?: boolean;
  exit?: (code: number) => void;
}

export interface Shinsa {
  url: string;
  engine: Engine;
  stop: () => Promise<void>;
}

type Services = ReturnType<typeof createServices>;

function createServices(config: ServerConfig, options: ShinsaOptions, instance: ServerInstance) {
  const store = new ConfigStore(config.configPath, config.machine);
  prepareDataDir(config);
  const eventLog = new EventLog(config.databasePath);
  const engine = new Engine(eventLog, {
    readOnly: config.inspect,
    stateVersion: BUNDLE?.stateVersion ?? resolveStateVersion(),
  });
  const transcripts = new Transcripts(config.transcriptsDir);
  const evidence = new EvidenceStore(config.evidenceDir);
  const eunoe = new EunoeServer({ dir: join(config.dataDir, 'eunoe') });
  const providers = options.providers ?? new ProviderRegistry(listDefaultProviders(eunoe));
  const accounts = new Accounts({
    engine,
    config,
    forward: options.onNotice,
    providerLogins: () => providers.listLogins(),
    providerUsage: providers.listUsageSources(),
    ...options.accountOptions,
  });
  const address = { url: resolveServerUrl(config.hostname, config.port) };
  const resolveLogin = options.resolveLogin ?? createLoginResolver(config.userHome);
  const quick = createQuickCalls(providers, () => engine.state.settings, accounts.readQuickFastMode);
  const classify = options.classify ?? createClassifier(quick.classify);
  const secrets = new SecretStore(join(config.dataDir, 'secrets.json'));
  const extensions = new Extensions({
    state: () => engine.state,
    config,
    secrets,
    baseUrl: () => address.url,
    ...options.extensions,
  });
  const versions = new Versions({
    inspect: config.inspect,
    onUpdated: () => accounts.syncProviderLogins(),
    ...options.versions,
  });
  const remote = new Remote({
    path: join(config.dataDir, REMOTE_FILE),
    control: new ControlClient({ origin: config.remoteOrigin }),
    connect: options.remoteConnect ?? createInstalledConnector(config.dataDir),
    localUrl: () => address.url,
    version: instance.version,
    maxBodyBytes: ATTACHMENT_REQUEST_LIMIT_BYTES,
    machineName: resolveMachineName(),
    openUrl: options.openRemoteUrl ?? createUrlOpener(config.userHome),
  });
  const shares = new Shares({ engine, remote, evidence, transcripts });
  const slack = new Slack({ engine, remote, ask: quick.classify });
  const schedules = new Schedules(engine, secrets, {
    ...options.scheduleClock,
    baseUrl: () => address.url,
    hookUrl: (scheduleId, token) => remote.resolveHookUrl(scheduleId, token),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const terminals = new Terminals({
    dataDir: config.dataDir,
    home: config.userHome,
    version: instance.version,
    readOnly: config.inspect,
    ...options.terminals,
  });
  const runs = new RunSupervisor(engine, config, transcripts, evidence, {
    schedules,
    services: terminals,
    extensions,
    ...(options.idle ? { idle: options.idle } : {}),
    ...(options.compaction ? { compaction: options.compaction } : {}),
    providers,
    startSession: options.startSession,
    onRejection: options.onRejection ?? accounts.onRejection,
    onNotice: accounts.onNotice,
    accounts,
    manage: {
      baseUrl: () => address.url,
      projects: createProjectChanges({ engine, resolveLogin, userHome: config.userHome }),
      route: createCommandRouter(engine, classify),
    },
  });
  const briefings = new Briefings(engine, { ask: quick.write });
  terminals.resumeServices(engine.state);
  const inbox = new MessageInbox(engine, classify.message);
  const roots = new Roots(
    config.roots,
    store,
    config.userHome,
    options.discover ?? createDiscoverer(Boolean(BUNDLE))
  );
  return {
    config,
    store,
    roots,
    eventLog,
    engine,
    transcripts,
    evidence,
    accounts,
    schedules,
    extensions,
    versions,
    runs,
    briefings,
    terminals,
    remote,
    shares,
    slack,
    inbox,
    quick,
    classify,
    resolveLogin,
    address,
    stopShinsa: null as (() => Promise<void>) | null,
    providers,
    eunoe,
    models: options.models ?? providers.resolve(engine.state.settings.defaultProvider),
    clocks: [
      new MonitorClock(engine),
      new WatchdogClock(engine),
      new UsageResumeClock(engine),
      new SilenceWatch(engine, transcripts),
      new ShareClock(engine),
    ],
    effects: new EffectRunner(engine, config, runs, briefings, {
      workspaces: runs.workspaces,
      shares,
      triage: options.triage ?? ((state, task, local) => resolveTriage(state, task, local, quick.classify)),
      findRepository: (state, task, local) => resolveRoundRepository(state, task, local, quick.classify),
      wordWatch: createWatchWriter(quick.write),
      resolveLogin,
      roots,
      services: terminals,
      slack,
    }),
  };
}

function startHttp(services: Services, options: ShinsaOptions, instance: ServerInstance) {
  const { engine, config, store, roots, models, accounts } = services;
  return startServer({
    engine,
    config,
    instance,
    transcripts: services.transcripts,
    terminals: services.terminals,
    refiner: new ServiceRefiner(services.quick.classify),
    evidence: services.evidence,
    models,
    providers: services.providers,
    onboarding: new Onboarding({
      engine,
      config,
      store,
      roots,
      resolveLogin: services.resolveLogin,
      ask: services.quick.write,
      models,
      run: options.runPrerequisite,
      accounts: options.accounts ?? createOnboardingAccounts(accounts),
      terminals: services.terminals,
    }),
    accounts,
    schedules: services.schedules,
    extensions: services.extensions,
    versions: services.versions,
    roots,
    resolveLogin: services.resolveLogin,
    classify: services.classify,
    place: options.place ?? createPlacementAsker(services.quick.classify),
    workspaces: services.runs.workspaces,
    remote: services.remote,
    shares: services.shares,
    slack: services.slack,
    restarter: createServiceRestarter(engine, {
      byService: options.byService ?? false,
      drain: services.runs,
      stop: () => services.stopShinsa?.() ?? Promise.resolve(),
      exit: options.exit,
    }),
  });
}

async function startWork(services: Services) {
  const { engine, effects } = services;
  engine.onEffect((effect, context) => effects.apply(effect, context));
  engine.onEffectExhausted((effect, error, key) => effects.reportExhausted(effect, error, key));
  engine.onEffectRetry((effect, retry, key) => effects.reportRetry(effect, retry, key));
  engine.start();
  effects.startWatching();
  services.schedules.start();
  for (const clock of services.clocks) clock.start();
  services.accounts.start().catch((error: unknown) => {
    log.warn('[Serve] Could not check the Claude accounts', { error: describeError(error) });
  });
  await services.runs.recover();
  await effects.recover();
  services.inbox.start();
  services.remote.start();
  services.briefings.schedule();
  services.extensions.syncSnapshot();
  void services.extensions.syncUsage();
  log.info('[Serve] Ready', { dataDir: services.config.dataDir, events: engine.state.seq });
}

function acquireServeLock(requested: ServerConfig, instance: ServerInstance) {
  if (requested.inspect) return null;
  return acquireDataDirLock(requested.dataDir, {
    ...instance,
    port: requested.port,
    url: resolveServerUrl(requested.hostname, requested.port),
  });
}

export async function startShinsa(requested: ServerConfig, options: ShinsaOptions = {}): Promise<Shinsa> {
  const instance = await resolveServerInstance();
  mkdirSync(requested.dataDir, { recursive: true });
  const lock = acquireServeLock(requested, instance);
  let services: Services;
  let http: ReturnType<typeof startHttp>;
  try {
    services = createServices(requested, options, instance);
    http = startHttp(services, options, instance);
  } catch (error) {
    lock?.release();
    throw error;
  }
  lock?.update({ port: http.server.port ?? requested.port, url: http.url });
  services.address.url = http.url;
  const { engine, config } = services;
  services.stopShinsa = () => shinsa.stop();
  const shinsa: Shinsa = {
    url: services.address.url,
    engine,
    stop: async () => {
      await services.runs.interruptForShutdown();
      services.briefings.stop();
      services.inbox.stop();
      services.schedules.stop();
      services.accounts.stop();
      services.versions.stop();
      await services.remote.stop();
      await services.terminals.stop();
      for (const clock of services.clocks) clock.stop();
      await services.effects.stop();
      await services.extensions.stop();
      engine.stop();
      await engine.settle();
      await services.eunoe.stop();
      await http.stop();
      services.eventLog.close();
      lock?.release();
    },
  };
  if (config.inspect) {
    log.info('[Serve] Inspect mode: agents, pull request sync and recovery are off', {
      dataDir: config.dataDir,
    });
    return shinsa;
  }
  await startWork(services);
  return shinsa;
}
