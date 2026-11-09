import { join } from 'node:path';
import { Clock, Console, Context, Effect, FileSystem, Layer } from 'effect';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { JsonFile } from '../../apps/engine/src/files/service.ts';
import { REMOTE_FILE } from '../../apps/engine/src/remote/index.ts';
import type { ResourceMonitor } from '../../apps/engine/src/resources/index.ts';
import { Shell } from '../../apps/engine/src/shell/index.ts';
import { Terminals } from '../../apps/engine/src/terminals/index.ts';
import { TerminalsLayer } from '../../apps/engine/src/terminals/layers.ts';
import { resolveConfig } from '../../apps/engine/test/helpers/config.ts';
import { Engine } from '../../apps/engine/test/helpers/engine.ts';
import { openEventLog } from '../../apps/engine/test/helpers/event-log.ts';
import { createTestEvidence } from '../../apps/engine/test/helpers/evidence.ts';
import { createTestSlackService } from '../../apps/engine/test/slack/harness.ts';
import { isTaskSettled, type MachineResources } from '../../packages/core/src/index.ts';
import { startRemoteServices } from '../kit/remote.ts';
import { startIdleServer } from '../kit/server.ts';
import { createTranscripts } from '../kit/transcripts.ts';
import { createRandomKey } from './requests.ts';
import {
  GIGABYTE,
  LOCAL_WEB,
  type Machine,
  ORIGIN,
  PREVIEW_LOADS,
  PREVIEW_ZONE,
  type PreviewLoad,
  ROOT,
  SANDBOX_DIR,
  SandboxFailed,
  SEED_TIMEOUT,
  USER,
} from './schema.ts';
import { listPreviewTeamKeys, MACHINE_MEMBERS, MACHINE_OWNERS, resolvePreviewTeams } from './team.ts';

export type StartedMachine = Effect.Success<ReturnType<typeof startMachine>>;

export const seedStudio = Effect.fn('Sandbox.seedStudio')(function* () {
  const shell = yield* Shell;
  const seedDir = join(SANDBOX_DIR, 'studio');
  const seeded = yield* shell.run({
    argv: ['bun', join(ROOT, 'scripts/seed.ts')],
    cwd: ROOT,
    env: { SHINSA_SEED_DIR: seedDir },
    timeout: SEED_TIMEOUT,
    onLine: (line) => Console.log(line),
  });
  if (!seeded.ok) return yield* new SandboxFailed({ message: 'Seeding Studio failed.' });
  return join(seedDir, 'data');
});

export const prepareMachine = Effect.fn('Sandbox.prepareMachine')(function* (id: string) {
  const dataDir = join(SANDBOX_DIR, id, 'data');
  const onboardedAt = yield* Clock.currentTimeMillis;
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.all([
    fs.makeDirectory(dataDir, { recursive: true }),
    fs.writeFileString(
      join(dataDir, 'config.json'),
      `${JSON.stringify({ version: 1, roots: [], onboardedAt }, null, 2)}\n`
    ),
  ]).pipe(
    Effect.mapError((error) => new SandboxFailed({ message: `Preparing ${id} failed: ${error.message}` }))
  );
  return dataDir;
});

export const startMachine = Effect.fn('Sandbox.startMachine')(function* (
  id: string,
  name: string,
  dataDir: string
) {
  const connectKey = createRandomKey(32);
  const owner = MACHINE_OWNERS[id] ?? USER;
  const credentials = {
    instanceId: id,
    machineToken: `preview-${id}`,
    tunnelToken: `preview-${id}`,
    tunnelHost: `t-${id}.shinsa.dev`,
    connectKey,
  };
  const remoteFile = JSON.stringify({
    version: 1,
    credentials,
    enabled: true,
    owner: owner.login,
    devices: [],
    access: { owner, members: MACHINE_MEMBERS[id] ?? [] },
    teams: resolvePreviewTeams(owner),
    teamKeys: listPreviewTeamKeys(owner),
  });
  const config = yield* Effect.promise(() =>
    resolveConfig({
      ...Bun.env,
      SHINSA_DATA_DIR: dataDir,
      SHINSA_PORT: '0',
      SHINSA_REMOTE_ORIGIN: ORIGIN,
      SHINSA_PREVIEW_ORIGIN: PREVIEW_ZONE,
      SHINSA_WEB_DIR: LOCAL_WEB,
    })
  );
  const fs = yield* FileSystem.FileSystem;
  yield* Effect.all([
    fs.writeFileString(join(dataDir, REMOTE_FILE), remoteFile),
    Effect.forEach([config.worktreesDir, config.evidenceDir, config.transcriptsDir], (dir) =>
      fs.makeDirectory(dir, { recursive: true })
    ),
  ]).pipe(
    Effect.mapError((error) => new SandboxFailed({ message: `Preparing ${name} failed: ${error.message}` }))
  );
  const engine = yield* Effect.acquireRelease(
    Effect.sync(() => new Engine(openEventLog(config.databasePath))),
    (started) => Effect.promise(() => started.dispose())
  );
  const evidence = createTestEvidence(config.evidenceDir);
  const transcripts = createTranscripts(config.transcriptsDir);
  const terminalsContext = yield* Layer.build(
    Terminals.layer({ version: 'preview', env: Bun.env }).pipe(
      Layer.provide(TerminalsLayer),
      Layer.provide(Layer.mergeAll(JsonFile.layer, Layer.succeed(EngineConfig, config)))
    )
  );
  const terminals = Context.get(terminalsContext, Terminals);
  const remote = yield* Effect.tryPromise({
    try: () =>
      startRemoteServices({
        engine,
        config,
        evidence,
        transcripts,
        terminals,
        refusal: 'The preview runs no tunnel.',
        localUrl: ORIGIN,
        version: 'preview',
        maxBodyBytes: 32 * 1024 * 1024,
        machineName: name,
      }),
    catch: (error) =>
      new SandboxFailed({ message: `Starting ${name}’s remote access failed: ${String(error)}` }),
  });
  const load: PreviewLoad | undefined = PREVIEW_LOADS[id];
  const resources: ResourceMonitor['Service'] | undefined = load && {
    snapshot: Effect.gen(function* () {
      const state = yield* engine.core.state;
      const sampledAt = yield* Clock.currentTimeMillis;
      const snapshot: MachineResources = {
        sampledAt,
        cores: load.cores,
        cpuPercent: load.cpuPercent,
        memoryUsedBytes: load.memoryUsedGb * GIGABYTE,
        memoryTotalBytes: load.memoryTotalGb * GIGABYTE,
        diskFreeBytes: load.diskFreeGb * GIGABYTE,
        diskTotalBytes: 500 * GIGABYTE,
        tasks: Object.values(state.tasks)
          .filter((task) => !isTaskSettled(task))
          .slice(0, 6)
          .map((task, index) => ({
            taskId: task.id,
            agent: { cpuPercent: 2 + index, memoryBytes: (0.3 + index / 10) * GIGABYTE },
            services:
              index % 3 === 1
                ? { cpuPercent: 3, memoryBytes: 0.7 * GIGABYTE }
                : { cpuPercent: 0, memoryBytes: 0 },
            checks:
              index === 0
                ? { cpuPercent: 28, memoryBytes: 1.6 * GIGABYTE }
                : { cpuPercent: 0, memoryBytes: 0 },
            processes: 3 + index,
            worktreeBytes: (0.8 + index / 2) * GIGABYTE,
          })),
      };
      return snapshot;
    }),
    subscribe: () => Effect.succeed(Effect.void),
    refresh: Effect.void,
    measureDisk: Effect.void,
  };
  const http = yield* Effect.acquireRelease(
    startIdleServer({
      engine,
      config,
      transcripts,
      evidence,
      remoteOrigin: config.remoteOrigin,
      ...remote.services,
      resources,
      terminals,
      slack: createTestSlackService({
        engine,
        origin: ORIGIN,
        credentials,
        fetch: (input, init) => fetch(input, init),
      }),
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.fail(new SandboxFailed({ message: `Starting ${name}’s server failed: ${String(error)}` }))
      )
    ),
    (started) => Effect.promise(() => started.stop())
  );
  engine.onEffect(remote.applyEffect);
  yield* Effect.sync(() => engine.start());
  yield* Effect.tryPromise({
    try: () => remote.start(),
    catch: (error) => new SandboxFailed({ message: `Starting ${name} failed: ${String(error)}` }),
  });
  const publicKey = yield* Effect.tryPromise({
    try: () => remote.resolveMachineKey(),
    catch: (error) => new SandboxFailed({ message: `Reading ${name}’s key failed: ${String(error)}` }),
  });
  const machine: Machine = { id, name, remote, port: http.server.port ?? 0, connectKey, publicKey };
  return { machine, engine, evidence, transcripts, terminals };
});
