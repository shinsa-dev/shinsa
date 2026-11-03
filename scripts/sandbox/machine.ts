import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Transcripts } from '../../apps/engine/src/agents/index.ts';
import { ProviderRegistry } from '../../apps/engine/src/agents/providers/index.ts';
import { createQuickCalls } from '../../apps/engine/src/agents/quick/index.ts';
import { ConfigStore, resolveConfig } from '../../apps/engine/src/config/index.ts';
import { startServer } from '../../apps/engine/src/http/index.ts';
import { Onboarding } from '../../apps/engine/src/onboarding/index.ts';
import { Handoffs } from '../../apps/engine/src/remote/handoffs.ts';
import {
  createRefusedConnector,
  REMOTE_FILE,
  Remote,
  RemoteControl,
} from '../../apps/engine/src/remote/index.ts';
import { createPlacementAsker } from '../../apps/engine/src/remote/placement.ts';
import { Previews } from '../../apps/engine/src/remote/previews.ts';
import { ShareClock } from '../../apps/engine/src/remote/share-clock.ts';
import { createShareDescriber } from '../../apps/engine/src/remote/share-describe.ts';
import { type ShareGitHub, Shares } from '../../apps/engine/src/remote/shares.ts';
import { TeamFeeds } from '../../apps/engine/src/remote/team-feeds.ts';
import { Teams } from '../../apps/engine/src/remote/teams.ts';
import { Roots } from '../../apps/engine/src/repos/index.ts';
import { Engine } from '../../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../apps/engine/src/store/index.ts';
import { Terminals } from '../../apps/engine/src/terminals/index.ts';
import {
  createSettings,
  isTaskSettled,
  type MachineResources,
  type Repo,
} from '../../packages/core/src/index.ts';
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

const QUICK = createQuickCalls(new ProviderRegistry(), createSettings);

const PLACE = createPlacementAsker(QUICK.classify);

const DESCRIBE = createShareDescriber(QUICK.write);

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
  return { snapshot, subscribe: () => () => undefined };
}

function acceptEveryRequest(remote: Remote) {
  const accepting = new Set<string>();
  remote.subscribe(() => {
    for (const request of remote.snapshot().requests) {
      if (accepting.has(request.id)) continue;
      accepting.add(request.id);
      void remote.acceptRequest(request.id).catch((error: unknown) => {
        console.error(`Could not accept ${request.deviceName}: ${String(error)}`);
      });
    }
  });
}

function readBranchDiff(repo: Repo, base: string, branch: string) {
  const diff = Bun.spawnSync(['git', '-C', repo.path, 'diff', `${base}...${branch}`]);
  if (diff.exitCode !== 0) throw new Error(`git diff ${base}...${branch} failed in ${repo.path}.`);
  return diff.stdout.toString();
}

function createPreviewGitHub(engine: Engine): ShareGitHub {
  return {
    readDiff: (repo, number) => {
      const task = Object.values(engine.state.tasks).find(
        (entry) => entry.repoId === repo.id && entry.pullRequest?.number === number
      );
      return Promise.resolve(readBranchDiff(repo, repo.defaultBranch, task?.branch ?? repo.defaultBranch));
    },
    readFile: (repo, ref, path) => {
      const task = Object.values(engine.state.tasks).find(
        (entry) => entry.repoId === repo.id && entry.pullRequest?.headSha === ref
      );
      const shown = Bun.spawnSync(['git', '-C', repo.path, 'show', `${task?.branch ?? ref}:${path}`]);
      if (shown.exitCode !== 0) return Promise.reject(new Error(`git show failed for ${path}.`));
      return Promise.resolve(shown.stdout.toString());
    },
  };
}

async function describePreviewShare(engine: Engine, taskId: string, key: string) {
  const task = engine.state.tasks[taskId];
  if (!task?.share) return;
  const description = await DESCRIBE(task);
  if (!description) return;
  await engine.dispatch({ type: 'share.describe', taskId, description }, { id: `${key}:share.describe` });
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
  const engine = new Engine(new EventLog(config.databasePath));
  const store = new ConfigStore(config.configPath);
  const roots = new Roots(config.roots, store, config.userHome, () =>
    Promise.resolve({ candidates: [], truncated: false })
  );
  const remote = new Remote({
    path: join(dataDir, REMOTE_FILE),
    control: new RemoteControl({ origin: ORIGIN }),
    connector: createRefusedConnector('The preview runs no tunnel.'),
    localUrl: () => ORIGIN,
    version: 'preview',
    maxBodyBytes: 32 * 1024 * 1024,
    machineName: name,
    openUrl: () => Promise.resolve(),
  });
  acceptEveryRequest(remote);
  const evidence = new EvidenceStore(config.evidenceDir);
  const transcripts = new Transcripts(config.transcriptsDir);
  const terminals = new Terminals({ dataDir, home: config.userHome, version: 'preview' });
  const shares = new Shares({
    engine,
    remote,
    evidence,
    transcripts,
    github: createPreviewGitHub(engine),
  });
  const teams = new Teams({ engine, remote, shares, transcripts });
  const teamFeeds = new TeamFeeds({ remote });
  const previews = new Previews({
    engine,
    remote,
    services: terminals,
    origin: config.previewOrigin,
  });
  const handoffs = new Handoffs({ engine, remote });
  terminals.applyRemoteUrls(previews);
  const http = startServer({
    engine,
    config,
    transcripts,
    evidence,
    models: { listModels: () => Promise.resolve([]) } as never,
    onboarding: new Onboarding({
      engine,
      config,
      store,
      roots,
      resolveLogin: () => Promise.resolve(null),
      ask: () => Promise.resolve(null),
      run: (command) =>
        Promise.resolve({ ok: true, code: 0, stdout: `${command[0]} 1.0`, stderr: '', timedOut: false }),
      models: { listModels: () => Promise.resolve([]) },
      accounts: () => Promise.resolve([]),
    }),
    remote,
    place: PLACE,
    shares,
    resources: PREVIEW_LOADS[id] ? createPreviewResources(engine, PREVIEW_LOADS[id]) : undefined,
    teams,
    teamFeeds,
    previews,
    terminals,
  });
  engine.onEffect(async (effect, context) => {
    if (effect.kind === 'share.link') await shares.link(effect.taskId, context);
    if (effect.kind === 'share.describe') await describePreviewShare(engine, effect.taskId, context.key);
    if (effect.kind === 'preview.link') await previews.link(effect.taskId, effect.serviceId, context);
    if (effect.kind === 'handoff.link') await handoffs.link(effect.taskId, context);
    if (effect.kind === 'handoff.revoke') await handoffs.revoke(effect.taskId, effect.guestId);
  });
  engine.start();
  new ShareClock(engine).start();
  teamFeeds.start();
  const key = await remote.store.resolveMachineKey();
  const machine: Machine = {
    id,
    name,
    remote,
    port: http.server.port ?? 0,
    connectKey,
    publicKey: key.publicKey,
  };
  return { machine, engine, evidence, transcripts, terminals };
}
