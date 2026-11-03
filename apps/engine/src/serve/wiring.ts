import { join } from 'node:path';
import { Accounts, createOnboardingAccounts, UsageResumeClock } from '../accounts/index.ts';
import {
  listDefaultProviders,
  ProviderRegistry,
  RunSupervisor,
  SilenceWatch,
  Transcripts,
} from '../agents/index.ts';
import { createQuickCalls } from '../agents/quick/index.ts';
import { Briefings } from '../briefing/index.ts';
import { resolveEngineChangelog } from '../changelog/index.ts';
import { ConfigStore, type ServerConfig } from '../config/index.ts';
import { EunoeServer } from '../eunoe/index.ts';
import { Extensions } from '../extensions/index.ts';
import { createFeedbackDrafter } from '../feedback/draft.ts';
import { resolveServerUrl, startServer } from '../http/index.ts';
import { BUNDLE, createServiceRestarter, INSTALL_PATH, type ServerInstance } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import { Onboarding } from '../onboarding/index.ts';
import { createProjectChanges } from '../projects/changes.ts';
import { Handoffs } from '../remote/handoffs.ts';
import {
  RemoteControl,
  createInstalledConnector,
  createUrlOpener,
  REMOTE_FILE,
  Remote,
  resolveMachineName,
} from '../remote/index.ts';
import { createPlacementAsker } from '../remote/placement.ts';
import { Previews } from '../remote/previews.ts';
import { ShareClock } from '../remote/share-clock.ts';
import { createShareDescriber } from '../remote/share-describe.ts';
import { Shares } from '../remote/shares.ts';
import { TeamFeeds } from '../remote/team-feeds.ts';
import { Teams } from '../remote/teams.ts';
import { createLoginResolver, Roots } from '../repos/index.ts';
import { ProcessLedger, ResourceMonitor } from '../resources/index.ts';
import { EffectRunner, Engine, MonitorClock, WatchdogClock } from '../runtime/index.ts';
import { Schedules } from '../schedules/index.ts';
import { createWatchWriter } from '../schedules/suggest.ts';
import { SecretStore } from '../secrets/index.ts';
import { Slack } from '../slack/index.ts';
import {
  ATTACHMENT_REQUEST_LIMIT_BYTES,
  type EventLog,
  EvidenceStore,
  resolveStateVersion,
} from '../store/index.ts';
import { ServiceRefiner, Terminals } from '../terminals/index.ts';
import { MessageInbox } from '../triage/inbox.ts';
import { resolveTriage } from '../triage/index.ts';
import { createClassifier, createCommandRouter, resolveRoundRepository } from '../triage/message.ts';
import { Versions } from '../versions/index.ts';

import type { ShinsaOptions } from './schema.ts';

export type Services = ReturnType<typeof createServices>;

const ACCOUNT_CHECKS = new WeakMap<Services, Promise<void>>();

export function createServices(
  config: ServerConfig,
  options: ShinsaOptions,
  instance: ServerInstance,
  eventLog: EventLog
) {
  const store = new ConfigStore(config.configPath, config.machine);
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
    control: new RemoteControl({ origin: config.remoteOrigin }),
    connector: options.remoteConnector ?? createInstalledConnector(config.dataDir),
    localUrl: () => address.url,
    version: instance.version,
    maxBodyBytes: ATTACHMENT_REQUEST_LIMIT_BYTES,
    machineName: resolveMachineName(),
    openUrl: options.openRemoteUrl ?? createUrlOpener(config.userHome),
  });
  const shares = new Shares({ engine, remote, evidence, transcripts });
  const handoffs = new Handoffs({ engine, remote });
  const teamFeeds = new TeamFeeds({ remote });
  const teams = new Teams({ engine, remote, shares, transcripts, held: teamFeeds });
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
  const previews = new Previews({ engine, remote, services: terminals, origin: config.previewOrigin });
  terminals.applyRemoteUrls(previews);
  const ledger = new ProcessLedger(terminals.listServiceProcesses);
  const resources = new ResourceMonitor({ ledger, state: () => engine.state, dataDir: config.dataDir });
  const runs = new RunSupervisor(engine, config, transcripts, evidence, {
    schedules,
    services: terminals,
    trackProcess: ledger.track,
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
      hookSecrets: (taskId) => schedules.hookSecrets(taskId),
    },
  });
  const briefings = new Briefings(engine, { ask: quick.write });
  terminals.resumeServices(engine.state);
  const inbox = new MessageInbox(engine, classify.message);
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
    versions,
    runs,
    briefings,
    terminals,
    resources,
    remote,
    shares,
    teams,
    teamFeeds,
    previews,
    slack,
    inbox,
    quick,
    classify,
    resolveLogin,
    address,
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
      previews,
      handoffs,
      triage:
        options.triage ??
        ((state, task, local) =>
          resolveTriage(state, task, local, quick.classify, () => ({
            feed: teamFeeds.snapshot(),
            teams: remote.store.file.teams,
            self: remote.store.file.credentials?.instanceId ?? null,
          }))),
      findRepository: (state, task, local) => resolveRoundRepository(state, task, local, quick.classify),
      wordWatch: createWatchWriter(quick.write),
      describeShare: createShareDescriber(quick.write),
      draftFeedback: createFeedbackDrafter(quick.write),
      instance,
      resolveLogin,
      roots,
      services: terminals,
      slack,
      trackProcess: ledger.track,
    }),
  };
}

export function startHttp(
  services: Services,
  options: ShinsaOptions,
  instance: ServerInstance,
  stop: () => Promise<void>
) {
  const { engine, config, store, roots, models, accounts } = services;
  return startServer({
    engine,
    config,
    instance,
    transcripts: services.transcripts,
    terminals: services.terminals,
    resources: services.resources,
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
    changelog: resolveEngineChangelog({
      built: process.env.SHINSA_BUILD_CHANGELOG,
      root: BUNDLE ? null : INSTALL_PATH,
    }),
    roots,
    resolveLogin: services.resolveLogin,
    classify: services.classify,
    place: options.place ?? createPlacementAsker(services.quick.classify),
    workspaces: services.runs.workspaces,
    remote: services.remote,
    shares: services.shares,
    teams: services.teams,
    teamFeeds: services.teamFeeds,
    previews: services.previews,
    slack: services.slack,
    restarter: createServiceRestarter(engine, {
      byService: options.byService ?? false,
      drain: services.runs,
      stop,
      exit: options.exit,
    }),
  });
}

export async function startWork(services: Services) {
  const { engine, effects } = services;
  engine.onEffect((effect, context) => effects.apply(effect, context));
  engine.onEffectExhausted((effect, error, key) => effects.reportExhausted(effect, error, key));
  engine.onEffectRetry((effect, retry, key) => effects.reportRetry(effect, retry, key));
  engine.start();
  effects.startWatching();
  services.schedules.start();
  for (const clock of services.clocks) clock.start();
  ACCOUNT_CHECKS.set(
    services,
    services.accounts.start().catch((error: unknown) => {
      log.warn('[Serve] Could not check the Claude accounts', { error: describeError(error) });
    })
  );
  await services.runs.recover();
  await effects.recover();
  services.inbox.start();
  services.remote.start();
  services.teamFeeds.start();
  services.briefings.schedule();
  services.extensions.syncSnapshot();
  void services.extensions.syncUsage();
  log.info('[Serve] Ready', { dataDir: services.config.dataDir, events: engine.state.seq });
}

export async function stopWork(services: Services) {
  await services.runs.interruptForShutdown();
  services.briefings.stop();
  services.inbox.stop();
  services.schedules.stop();
  services.accounts.stop();
  services.versions.stop();
  services.teamFeeds.stop();
  services.resources.stop();
  await services.remote.stop();
  await services.terminals.stop();
  for (const clock of services.clocks) clock.stop();
  await services.effects.stop();
  await services.extensions.stop();
  services.engine.stop();
  await services.engine.settle();
}

export async function disposeRuntime(services: Services) {
  await ACCOUNT_CHECKS.get(services);
  await services.effects.dispose();
  await services.engine.dispose();
}
