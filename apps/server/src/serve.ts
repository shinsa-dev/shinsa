import { ModelCatalog, RunSupervisor, type SessionStarter, Transcripts } from './agents/index.ts';
import { Briefings } from './briefing/index.ts';
import type { ServerConfig } from './config/index.ts';
import { startServer } from './http/index.ts';
import { log } from './log/index.ts';
import type { LoginResolver } from './repos/index.ts';
import { EffectRunner, Engine } from './runtime/index.ts';
import { EventLog, EvidenceStore } from './store/index.ts';
import type { TriageResolver } from './triage/index.ts';

export interface ShinsaOptions {
  startSession?: SessionStarter;
  triage?: TriageResolver;
  resolveLogin?: LoginResolver;
  models?: ModelCatalog;
}

export interface Shinsa {
  url: string;
  engine: Engine;
  stop: () => Promise<void>;
}

export async function startShinsa(config: ServerConfig, options: ShinsaOptions = {}): Promise<Shinsa> {
  const eventLog = new EventLog(config.databasePath);
  const engine = new Engine(eventLog);
  const transcripts = new Transcripts(config.transcriptsDir);
  const evidence = new EvidenceStore(config.evidenceDir);
  const runs = new RunSupervisor(engine, config, transcripts, evidence, {
    startSession: options.startSession,
  });
  const briefings = new Briefings(engine);
  const effects = new EffectRunner(engine, config, runs, briefings, {
    triage: options.triage,
    resolveLogin: options.resolveLogin,
  });
  const http = startServer({
    engine,
    config,
    transcripts,
    evidence,
    models: options.models ?? new ModelCatalog(),
  });
  const shinsa: Shinsa = {
    url: `http://${config.hostname}:${http.server.port}`,
    engine,
    stop: async () => {
      briefings.stop();
      effects.stop();
      engine.stop();
      await http.stop();
      eventLog.close();
    },
  };
  if (config.inspect) {
    log.info('[Serve] Inspect mode: agents, pull request sync and recovery are off', {
      dataDir: config.dataDir,
    });
    return shinsa;
  }
  engine.onEffect((effect) => effects.apply(effect));
  engine.onEffectExhausted((effect, error) => effects.reportExhausted(effect, error));
  engine.start();
  effects.startWatching();
  await runs.recover();
  await effects.recover();
  briefings.schedule();
  log.info('[Serve] Ready', { dataDir: config.dataDir, events: engine.state.seq });
  return shinsa;
}
