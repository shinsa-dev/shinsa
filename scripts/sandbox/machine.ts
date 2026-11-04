import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REMOTE_FILE } from '../../apps/engine/src/remote/index.ts';
import { resolveConfig } from '../../apps/engine/test/helpers/config.ts';
import { Engine } from '../../apps/engine/test/helpers/engine.ts';
import { openEventLog } from '../../apps/engine/test/helpers/event-log.ts';
import { createTestEvidence } from '../../apps/engine/test/helpers/evidence.ts';
import { isTaskSettled, type MachineResources } from '../../packages/core/src/index.ts';
import { startRemoteServices } from '../kit/remote.ts';
import { startIdleServer } from '../kit/server.ts';
import { createFixedResources, startTerminals } from '../kit/terminals.ts';
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
  USER,
} from './schema.ts';
import { listPreviewTeamKeys, MACHINE_OWNERS, resolvePreviewTeams } from './team.ts';

export type StartedMachine = Awaited<ReturnType<typeof startMachine>>;

export function seedStudio() {
  const seedDir = join(SANDBOX_DIR, 'studio');
  const seeded = Bun.spawnSync(['bun', join(ROOT, 'scripts/seed.ts')], {
    env: { ...Bun.env, SHINSA_SEED_DIR: seedDir },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (seeded.exitCode !== 0) throw new Error('Seeding Studio failed.');
  return join(seedDir, 'data');
}

export function prepareMachine(id: string) {
  const dataDir = join(SANDBOX_DIR, id, 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [], onboardedAt: Date.now() }, null, 2)}\n`
  );
  return dataDir;
}

function writeRemoteFile(dataDir: string, id: string, connectKey: string) {
  const owner = MACHINE_OWNERS[id] ?? USER;
  const credentials = {
    instanceId: id,
    machineToken: `preview-${id}`,
    tunnelToken: `preview-${id}`,
    tunnelHost: `t-${id}.shinsa.dev`,
    connectKey,
  };
  writeFileSync(
    join(dataDir, REMOTE_FILE),
    JSON.stringify({
      version: 1,
      credentials,
      enabled: true,
      owner: owner.login,
      devices: [],
      access: { owner, members: [] },
      teams: resolvePreviewTeams(owner),
      teamKeys: listPreviewTeamKeys(owner),
    })
  );
}

function createPreviewResources(engine: Engine, load: PreviewLoad) {
  const snapshot = (): MachineResources => ({
    sampledAt: Date.now(),
    cores: load.cores,
    cpuPercent: load.cpuPercent,
    memoryUsedBytes: load.memoryUsedGb * GIGABYTE,
    memoryTotalBytes: load.memoryTotalGb * GIGABYTE,
    diskFreeBytes: load.diskFreeGb * GIGABYTE,
    diskTotalBytes: 500 * GIGABYTE,
    tasks: Object.values(engine.state.tasks)
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
          index === 0 ? { cpuPercent: 28, memoryBytes: 1.6 * GIGABYTE } : { cpuPercent: 0, memoryBytes: 0 },
        processes: 3 + index,
        worktreeBytes: (0.8 + index / 2) * GIGABYTE,
      })),
  });
  return createFixedResources(snapshot);
}

export async function startMachine(id: string, name: string, dataDir: string) {
  const connectKey = createRandomKey(32);
  writeRemoteFile(dataDir, id, connectKey);
  const config = resolveConfig({
    ...Bun.env,
    SHINSA_DATA_DIR: dataDir,
    SHINSA_PORT: '0',
    SHINSA_REMOTE_ORIGIN: ORIGIN,
    SHINSA_PREVIEW_ORIGIN: PREVIEW_ZONE,
    SHINSA_WEB_DIR: LOCAL_WEB,
  });
  for (const dir of [config.worktreesDir, config.evidenceDir, config.transcriptsDir])
    mkdirSync(dir, { recursive: true });
  const engine = new Engine(openEventLog(config.databasePath));
  const evidence = createTestEvidence(config.evidenceDir);
  const transcripts = createTranscripts(config.transcriptsDir);
  const terminals = await startTerminals(config, 'preview');
  const remote = await startRemoteServices({
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
  });
  const http = startIdleServer({
    engine,
    config,
    transcripts,
    evidence,
    remoteOrigin: config.remoteOrigin,
    ...remote.services,
    resources: PREVIEW_LOADS[id] ? createPreviewResources(engine, PREVIEW_LOADS[id]) : undefined,
    terminals,
  });
  engine.onEffect(remote.applyEffect);
  engine.start();
  await remote.start();
  const machine: Machine = {
    id,
    name,
    remote,
    port: http.server.port ?? 0,
    connectKey,
    publicKey: await remote.resolveMachineKey(),
  };
  return { machine, engine, evidence, transcripts, terminals };
}
