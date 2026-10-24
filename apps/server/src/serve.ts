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
import { EunoeProxy, resolveEunoeCommand } from './eunoe/index.ts';
import { Extensions, type ExtensionsOptions } from './extensions/index.ts';
import { resolveServerUrl, startServer } from './http/index.ts';
import { describeError, log } from './log/index.ts';
import { type AccountSource, type CommandRunner, type Interpreter, Onboarding } from './onboarding/index.ts';
import { createProjectChanges } from './projects/routes.ts';
import { createLoginResolver, type Discoverer, type LoginResolver, Roots } from './repos/index.ts';
import { EffectRunner, Engine, MonitorClock, type StateClockOptions } from './runtime/index.ts';
import { Schedules } from './schedules/index.ts';
import { SecretStore } from './secrets/index.ts';
import { EventLog, EvidenceStore } from './store/index.ts';
import { resolveTriage, type TriageResolver } from './triage/index.ts';
import { createCommandRouter, createMessageClassifier, type MessageClassifier } from './triage/message.ts';

export interface ShinsaOptions {
  startSession?: SessionStarter;
  onRejection?: RejectionHandler;
  onNotice?: NoticeListener;
  triage?: TriageResolver;
  classifyMessage?: MessageClassifier;
  resolveLogin?: LoginResolver;
  providers?: ProviderRegistry;
  models?: ModelSource;
  discover?: Discoverer;
  runPrerequisite?: CommandRunner;
  accounts?: AccountSource;
  interpret?: Interpreter;
  clarify?: Interpreter;
  accountOptions?: Omit<AccountsOptions, 'engine' | 'config'>;
  scheduleClock?: StateClockOptions;
  timeZone?: string;
  idle?: IdleReleaseOptions;
  compaction?: IdleCompactionOptions;
  extensions?: Pick<ExtensionsOptions, 'check' | 'env' | 'fetch'>;
}

export interface Shinsa {
  url: string;
  engine: Engine;
  stop: () => Promise<void>;
}

type Services = ReturnType<typeof createServices>;

function createServices(requested: ServerConfig, options: ShinsaOptions) {
  const store = new ConfigStore(requested.configPath, requested.machine);
  const config = prepareDataDir(requested, store);
  const eventLog = new EventLog(config.databasePath);
  const engine = new Engine(eventLog);
  const transcripts = new Transcripts(config.transcriptsDir);
  const evidence = new EvidenceStore(config.evidenceDir);
  const eunoe = new EunoeProxy({
    dir: join(config.dataDir, 'eunoe'),
    command: resolveEunoeCommand(config.eunoe.command),
    port: config.eunoe.port,
  });
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
  const classify = options.classifyMessage ?? createMessageClassifier(quick.classify);
  const secrets = new SecretStore(join(config.dataDir, 'secrets.json'));
  const extensions = new Extensions({
    state: () => engine.state,
    config,
    secrets,
    baseUrl: () => address.url,
    ...options.extensions,
  });
  const schedules = new Schedules(engine, secrets, {
    ...options.scheduleClock,
    baseUrl: () => address.url,
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });
  const runs = new RunSupervisor(engine, config, transcripts, evidence, {
    schedules,
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
  const roots = new Roots(config.roots, store, config.userHome, options.discover);
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
    runs,
    briefings,
    quick,
    classify,
    resolveLogin,
    address,
    providers,
    eunoe,
    models: options.models ?? providers.resolve(engine.state.settings.defaultProvider),
    clocks: [new MonitorClock(engine), new UsageResumeClock(engine), new SilenceWatch(engine, transcripts)],
    effects: new EffectRunner(engine, config, runs, briefings, {
      triage: options.triage ?? ((state, task, local) => resolveTriage(state, task, local, quick.classify)),
      resolveLogin,
      roots,
    }),
  };
}

function startHttp(services: Services, options: ShinsaOptions) {
  const { engine, config, store, roots, models, accounts } = services;
  const onboardingAccounts = createOnboardingAccounts(accounts);
  return startServer({
    engine,
    config,
    transcripts: services.transcripts,
    evidence: services.evidence,
    models,
    providers: services.providers,
    onboarding: new Onboarding({
      engine,
      config,
      store,
      roots,
      models,
      run: options.runPrerequisite,
      accounts: options.accounts ?? onboardingAccounts.source,
      accountActions: onboardingAccounts.actions,
      interpret: options.interpret ?? services.quick.classify,
      clarify: options.clarify ?? services.quick.write,
    }),
    accounts,
    schedules: services.schedules,
    extensions: services.extensions,
    roots,
    resolveLogin: services.resolveLogin,
    classify: services.classify,
  });
}

async function startWork(services: Services) {
  const { engine, effects } = services;
  engine.onEffect((effect, context) => effects.apply(effect, context));
  engine.onEffectExhausted((effect, error, key) => effects.reportExhausted(effect, error, key));
  engine.start();
  effects.startWatching();
  services.schedules.start();
  for (const clock of services.clocks) clock.start();
  services.accounts.start().catch((error: unknown) => {
    log.warn('[Serve] Could not check the Claude accounts', { error: describeError(error) });
  });
  await services.runs.recover();
  await effects.recover();
  services.briefings.schedule();
  void services.extensions.syncUsage();
  log.info('[Serve] Ready', { dataDir: services.config.dataDir, events: engine.state.seq });
}

export async function startShinsa(requested: ServerConfig, options: ShinsaOptions = {}): Promise<Shinsa> {
  const services = createServices(requested, options);
  const http = startHttp(services, options);
  services.address.url = http.url;
  const { engine, config } = services;
  const shinsa: Shinsa = {
    url: services.address.url,
    engine,
    stop: async () => {
      await services.runs.interruptForShutdown();
      services.briefings.stop();
      services.schedules.stop();
      services.accounts.stop();
      for (const clock of services.clocks) clock.stop();
      await services.effects.stop();
      await services.extensions.stop();
      engine.stop();
      await engine.settle();
      await services.eunoe.stop();
      await http.stop();
      services.eventLog.close();
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
