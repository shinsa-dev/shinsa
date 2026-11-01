import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import {
  isPreviewHost,
  PREVIEW_ACCESS_COOKIE,
  PREVIEW_COOKIE,
  respondPreview,
} from '../apps/cloud/src/previews.ts';
import type { CloudWorld } from '../apps/cloud/src/world.ts';
import { Transcripts } from '../apps/engine/src/agents/index.ts';
import { ProviderRegistry } from '../apps/engine/src/agents/providers/index.ts';
import { createQuickCalls } from '../apps/engine/src/agents/quick/index.ts';
import { ConfigStore, resolveConfig } from '../apps/engine/src/config/index.ts';
import { normalizeRemote } from '../apps/engine/src/git/repo.ts';
import { startServer } from '../apps/engine/src/http/index.ts';
import { Onboarding } from '../apps/engine/src/onboarding/index.ts';
import { ControlClient, REMOTE_FILE, Remote } from '../apps/engine/src/remote/index.ts';
import { createPlacementAsker } from '../apps/engine/src/remote/placement.ts';
import { Previews } from '../apps/engine/src/remote/previews.ts';
import { ShareClock } from '../apps/engine/src/remote/share-clock.ts';
import { createShareDescriber } from '../apps/engine/src/remote/share-describe.ts';
import { type ShareGitHub, Shares } from '../apps/engine/src/remote/shares.ts';
import { TeamFeeds } from '../apps/engine/src/remote/team-feeds.ts';
import { Teams } from '../apps/engine/src/remote/teams.ts';
import { Roots } from '../apps/engine/src/repos/index.ts';
import { Engine } from '../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../apps/engine/src/store/index.ts';
import { Terminals } from '../apps/engine/src/terminals/index.ts';
import { resolveServiceRunIn } from '../apps/engine/src/terminals/routes.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  createPreviewAccessToken,
  createSettings,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  isTaskSettled,
  type MachineResources,
  type NativeSignInTokenResponse,
  PREVIEW_ACCESS_HEADER,
  PREVIEW_ACCESS_PARAM,
  PREVIEW_KEY_HEADER,
  PREVIEW_OPEN_TTL_MS,
  parsePreviewHost,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteTeam,
  type RemoteUser,
  type Repo,
  resolveKeyFingerprint,
  resolvePreviewTunnelPath,
  resolveTaskProject,
  resolveTeamChannelUrl,
  resolveTeamJoinUrl,
  SHARE_CHANNEL_PATH,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  type ShareConnectResponse,
  type ShareLink,
  type SharePreset,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
  TEAM_CHANNEL_PATH,
  type TeamJoinResponse,
  type TeamPreviewResponse,
} from '../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(Bun.env.PORT ?? 5195);
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const PREVIEW_ZONE = `http://localhost:${PORT}`;
const SANDBOX_DIR = Bun.env.SHINSA_SANDBOX_DIR ?? join('/tmp', `shinsa-sandbox-${PORT}`);
const REMOTE_WEB = join(ROOT, 'apps/web/dist-remote');
const LOCAL_WEB = join(ROOT, 'apps/web/dist');
const USER: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };
const QUICK = createQuickCalls(new ProviderRegistry(), createSettings);

const PLACE = createPlacementAsker(QUICK.classify);

const DESCRIBE = createShareDescriber(QUICK.write);

const LAPTOP_TASKS = [
  {
    request: 'Add a dark mode toggle to the marketing site header',
    title: 'Add a dark mode toggle',
    branch: 'feat/dark-mode-toggle',
  },
  {
    request: 'Find why the nightly backup job skips Sundays',
    title: 'Find why backups skip Sundays',
    branch: 'fix/sunday-backups',
  },
  {
    request: 'Compare three charting libraries for the stats page and recommend one',
    title: 'Compare charting libraries',
    branch: 'docs/charting-libraries',
  },
];

const TEAMMATE: RemoteUser = { id: '2', login: 'kai', name: 'Kai Tanaka', avatarUrl: null };

const TEAMMATE_TASKS = [
  {
    request: 'Let a paywall be duplicated from its menu, with its products and copy',
    title: 'Duplicate a paywall from its menu',
    branch: 'feat/duplicate-paywall',
  },
  {
    request: 'Find why paywall previews flicker when the theme changes',
    title: 'Find why previews flicker on theme change',
    branch: 'fix/preview-flicker',
  },
  {
    request: 'Move the paywall list to the new table component',
    title: 'Move the paywall list to the new table',
    branch: 'refactor/paywall-table',
  },
];

const TEAM_INVITE = 'preview-team-invite';

const TEAM_KEY = serializeBase64Url(crypto.getRandomValues(new Uint8Array(32)));

const MACHINE_OWNERS: Record<string, RemoteUser> = { studio: USER, laptop: USER, kai: TEAMMATE };

const TEAM: Omit<RemoteTeam, 'role'> = {
  id: 'core',
  name: 'Product team',
  owner: USER,
  members: [{ user: TEAMMATE, addedAt: Date.now() - 3 * 24 * 60 * 60 * 1000 }],
  requests: [
    {
      user: { id: '3', login: 'ines', name: 'Inês Costa', avatarUrl: null },
      addedAt: Date.now() - 60 * 60 * 1000,
    },
  ],
  machines: [
    { id: 'studio', name: 'Studio', userId: USER.id, online: true, lastSeenAt: Date.now() },
    { id: 'laptop', name: 'Laptop', userId: USER.id, online: true, lastSeenAt: Date.now() },
    { id: 'kai', name: 'Kai’s MacBook', userId: TEAMMATE.id, online: true, lastSeenAt: Date.now() },
  ],
  createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DESIGN_PEOPLE: RemoteUser[] = [
  { id: '21', login: 'ines', name: 'Inês Costa', avatarUrl: null },
  { id: '22', login: 'theo', name: 'Theo Park', avatarUrl: null },
  { id: '23', login: 'amara', name: 'Amara Obi', avatarUrl: null },
  { id: '24', login: 'jonas', name: 'Jonas Weber', avatarUrl: null },
  { id: '25', login: 'lea', name: 'Léa Martin', avatarUrl: null },
  { id: '26', login: 'sam', name: null, avatarUrl: null },
  { id: '27', login: 'priya', name: 'Priya Nair', avatarUrl: null },
];

const OTHER_TEAMS: Omit<RemoteTeam, 'role'>[] = [
  {
    id: 'design',
    name: 'Design systems',
    owner: TEAMMATE,
    members: [USER, ...DESIGN_PEOPLE].map((user, index) => ({
      user,
      addedAt: Date.now() - (index + 1) * DAY_MS,
    })),
    requests: [],
    machines: [{ id: 'kai', name: 'Kai’s MacBook', userId: TEAMMATE.id, online: false, lastSeenAt: null }],
    createdAt: Date.now() - 30 * DAY_MS,
  },
  {
    id: 'platform',
    name: 'Platform',
    owner: USER,
    members: [],
    requests: [],
    machines: TEAM.machines.filter((machine) => machine.userId === USER.id),
    createdAt: Date.now() - DAY_MS,
  },
];

const REQUESTED_TEAM = { id: 'growth', name: 'Growth' };

const PREVIEW_TEAM_KEYS: Record<string, string> = Object.fromEntries(
  [...OTHER_TEAMS, REQUESTED_TEAM].map((team) => [
    team.id,
    serializeBase64Url(crypto.getRandomValues(new Uint8Array(32))),
  ])
);

function isInTeam(team: Omit<RemoteTeam, 'role'>, user: RemoteUser) {
  return team.owner.id === user.id || team.members.some((member) => member.user.id === user.id);
}

const teammateLink = {
  online: true,
  signingKey: null as string | null,
  sockets: new Set<ServerWebSocket<TunnelData>>(),
};

function resolvePreviewTeams(owner: RemoteUser): RemoteTeam[] {
  return [TEAM, ...OTHER_TEAMS]
    .filter((team) => isInTeam(team, owner))
    .map((team) => {
      const role = owner.id === team.owner.id ? 'owner' : 'member';
      const machines = team.machines.map((machine) =>
        machine.userId === TEAMMATE.id && team.id === TEAM.id
          ? {
              ...machine,
              online: teammateLink.online,
              ...(teammateLink.signingKey ? { signingKey: teammateLink.signingKey } : {}),
            }
          : machine
      );
      return { ...team, role, machines, requests: role === 'owner' ? team.requests : [] };
    });
}

const TEAMMATE_TOGGLE = /^\/sandbox\/teammate\/(online|offline)$/;

function toggleTeammate(url: URL) {
  teammateLink.online = url.pathname.endsWith('/online');
  if (!teammateLink.online) for (const socket of [...teammateLink.sockets]) socket.close(1001, 'Offline');
  return new Response(`Kai’s MacBook is ${teammateLink.online ? 'online' : 'offline'}.`);
}

function listPreviewTeamKeys(owner: RemoteUser) {
  const keys = resolvePreviewTeams(owner).map((team) => ({
    teamId: team.id,
    name: team.name,
    key: PREVIEW_TEAM_KEYS[team.id] ?? TEAM_KEY,
    invite: team.role !== 'owner' ? null : team.id === TEAM.id ? TEAM_INVITE : `${TEAM_INVITE}-${team.id}`,
    addedAt: team.createdAt,
  }));
  if (owner.id !== USER.id) return keys;
  return [
    ...keys,
    {
      teamId: REQUESTED_TEAM.id,
      name: REQUESTED_TEAM.name,
      key: PREVIEW_TEAM_KEYS[REQUESTED_TEAM.id] ?? TEAM_KEY,
      invite: null,
      addedAt: Date.now() - 2 * 60 * 60 * 1000,
    },
  ];
}

interface Machine {
  id: string;
  name: string;
  remote: Remote;
  port: number;
  connectKey: string;
  publicKey: string;
}

interface PreviewShare {
  url: string;
  label: string;
  handle: string;
  port: number;
}

interface ServicePreview {
  url: string;
  privateUrl: string | null;
  handle: string;
  port: number;
}

interface SharedService {
  engine: Engine;
  terminals: Terminals;
  serviceId: string;
  taskId: string;
}

const SHARE_CONNECT = new RegExp(`^${REMOTE_PATHS.shares}/([a-z]+)/connect$`);

function createShareLink(instanceId: string): ShareLink {
  const random = (bytes: number) => serializeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
  return { instanceId, shareId: random(SHARE_ID_BYTES), key: random(SHARE_KEY_BYTES) };
}

function seedStudio() {
  const seedDir = join(SANDBOX_DIR, 'studio');
  const seeded = Bun.spawnSync(['bun', join(ROOT, 'scripts/seed.ts')], {
    env: { ...Bun.env, SHINSA_SEED_DIR: seedDir },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (seeded.exitCode !== 0) throw new Error('Seeding Studio failed.');
  return join(seedDir, 'data');
}

function prepareMachine(id: string) {
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

const GIGABYTE = 1024 ** 3;

interface PreviewLoad {
  cores: number;
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  diskFreeGb: number;
}

const PREVIEW_LOADS: Record<string, PreviewLoad> = {
  studio: { cores: 12, cpuPercent: 46, memoryUsedGb: 21, memoryTotalGb: 32, diskFreeGb: 180 },
  laptop: { cores: 8, cpuPercent: 12, memoryUsedGb: 6, memoryTotalGb: 16, diskFreeGb: 64 },
};

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

async function startMachine(id: string, name: string, dataDir: string) {
  const connectKey = serializeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
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
    control: new ControlClient({ origin: ORIGIN }),
    connect: () => Promise.reject(new Error('The preview runs no tunnel.')),
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

async function describePreviewShare(engine: Engine, taskId: string, key: string) {
  const task = engine.state.tasks[taskId];
  if (!task?.share) return;
  const description = await DESCRIBE(task);
  if (!description) return;
  await engine.dispatch({ type: 'share.describe', taskId, description }, { id: `${key}:share.describe` });
}

interface SeedProject {
  repo: string;
  project: string;
  tasks: typeof LAPTOP_TASKS;
}

async function seedProject(engine: Engine, dataDir: string, seed: SeedProject) {
  const path = join(dataDir, '..', seed.repo);
  mkdirSync(path, { recursive: true });
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: seed.repo, path, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: seed.project,
  });
  const repo = Object.values(engine.state.repos).find((entry) => entry.name === seed.repo);
  if (!repo) throw new Error(`Registering ${seed.repo} failed.`);
  for (const task of seed.tasks) {
    await engine.dispatch({ type: 'task.create', request: task.request, repoId: repo.id });
    const created = Object.values(engine.state.tasks).find((entry) => entry.request === task.request);
    if (!created) throw new Error(`Creating a ${seed.project} task failed.`);
    await engine.dispatch({
      type: 'task.triage',
      taskId: created.id,
      title: task.title,
      repoId: repo.id,
      size: 'small',
      branch: task.branch,
      waitsOn: [],
    });
  }
  return repo;
}

async function shareProjectWithTeam(engine: Engine, projectId: string | undefined) {
  if (!projectId) throw new Error('No project to share with the preview team.');
  await engine.dispatch({ type: 'project.add_to_team', projectId, teamId: TEAM.id });
}

async function seedTeammateDuplicate(
  engine: Engine,
  projectId: string | undefined,
  original: Task | undefined
) {
  const repo = Object.values(engine.state.repos).find((entry) => entry.projectId === projectId);
  if (!(repo && original)) throw new Error('No project or teammate task for the teammate duplicate.');
  const request = 'Let people copy a paywall from the list, products and copy included';
  await engine.dispatch({ type: 'task.create', request, repoId: repo.id });
  const created = Object.values(engine.state.tasks).find((entry) => entry.request === request);
  if (!created) throw new Error('Creating the teammate duplicate failed.');
  await engine.dispatch({
    type: 'task.triage',
    taskId: created.id,
    title: 'Copy a paywall from the list',
    repoId: repo.id,
    size: 'small',
    branch: 'feat/copy-paywall',
    waitsOn: [],
    duplicateOfTeammate: {
      teamId: TEAM.id,
      machineId: 'kai',
      taskId: original.id,
      handle: original.handle ?? null,
      title: original.title,
      owner: { login: TEAMMATE.login, name: TEAMMATE.name, avatarUrl: TEAMMATE.avatarUrl },
    },
    reasons: { duplicate: 'Kai is already adding a Duplicate action to the paywall menu.' },
  });
  return engine.state.tasks[created.id] ?? created;
}

function selectBusiestProject(engine: Engine) {
  const counts = new Map<string, number>();
  for (const task of Object.values(engine.state.tasks)) {
    const projectId = resolveTaskProject(engine.state, task);
    if (projectId && !task.watchHome) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function listInstances(machines: Machine[]): Promise<RemoteInstance[]> {
  const now = Date.now();
  return Promise.all(
    machines.map(async (machine) => ({
      id: machine.id,
      name: machine.name,
      fingerprint: await resolveKeyFingerprint(machine.publicKey),
      online: true,
      lastSeenAt: now,
      createdAt: now - 7 * 24 * 60 * 60 * 1000,
      owner: USER,
      role: 'owner',
    }))
  );
}

function readBranchDiff(repo: Repo, base: string, branch: string) {
  const diff = Bun.spawnSync(['git', '-C', repo.path, 'diff', `${base}...${branch}`]);
  if (diff.exitCode !== 0) throw new Error(`git diff ${base}...${branch} failed in ${repo.path}.`);
  return diff.stdout.toString();
}

function countStoredEvidence(engine: Engine, taskId: string) {
  return Object.values(engine.state.evidence).filter(
    (item) => item.taskId === taskId && item.uri.startsWith('/api/evidence/')
  ).length;
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

function hasBranch(repo: Repo, branch: string) {
  return Bun.spawnSync(['git', '-C', repo.path, 'rev-parse', '--verify', '--quiet', branch]).exitCode === 0;
}

async function normalizeSeedRemote(engine: Engine, repo: Repo) {
  if (!repo.remote) return repo;
  await engine.dispatch({
    type: 'repo.update',
    repoId: repo.id,
    patch: { remote: normalizeRemote(repo.remote) },
  });
  return engine.state.repos[repo.id] ?? repo;
}

async function createPreviewShare(
  studio: Awaited<ReturnType<typeof startMachine>>,
  task: Task,
  label: string,
  preset: SharePreset = 'standard'
): Promise<PreviewShare | null> {
  const seeded = task.repoId ? studio.engine.state.repos[task.repoId] : undefined;
  if (!seeded) return null;
  await normalizeSeedRemote(studio.engine, seeded);
  const url = serializeShareUrl(ORIGIN, createShareLink(studio.machine.id));
  if (!task.share)
    await studio.engine.dispatch({ type: 'task.share', taskId: task.id, limit: 'none', preset });
  await studio.engine.dispatch({ type: 'share.record', taskId: task.id, url });
  return { url, label, handle: task.handle ?? task.id, port: studio.machine.port };
}

async function recordPushedHead(engine: Engine, task: Task) {
  const repo = task.repoId ? engine.state.repos[task.repoId] : undefined;
  if (!(repo && task.branch && task.pullRequest) || task.pullRequest.headSha) return task;
  const parsed = Bun.spawnSync(['git', '-C', repo.path, 'rev-parse', task.branch]);
  const headSha = parsed.stdout.toString().trim();
  await engine.dispatch({
    type: 'pull_request.record',
    taskId: task.id,
    pullRequest: { ...task.pullRequest, headSha },
  });
  return engine.state.tasks[task.id] ?? task;
}

const SEEDED_MESSAGES = [
  'Can you keep the old export working for one more release?',
  'Looks good so far. Please also cover the empty state.',
];

function seedMessages(studio: Awaited<ReturnType<typeof startMachine>>, task: Task) {
  const [run] = Object.values(studio.engine.state.runs)
    .filter((entry) => entry.taskId === task.id)
    .sort((left, right) => right.startedAt - left.startedAt);
  if (!run) return;
  for (const text of SEEDED_MESSAGES)
    studio.transcripts.record(run.id, { type: 'user', from: 'you', text, attachments: [] });
}

function countRuns(engine: Engine, taskId: string) {
  return Object.values(engine.state.runs).filter((run) => run.taskId === taskId).length;
}

async function createPreviewShares(studio: Awaited<ReturnType<typeof startMachine>>) {
  const { engine } = studio;
  const tasks = Object.values(engine.state.tasks).filter((entry) => entry.report && entry.repoId);
  const coded = tasks.find((entry) => {
    const repo = entry.repoId ? engine.state.repos[entry.repoId] : undefined;
    return entry.pullRequest?.state === 'open' && entry.branch && repo && hasBranch(repo, entry.branch);
  });
  const [evidenced] = tasks.sort(
    (left, right) => countStoredEvidence(engine, right.id) - countStoredEvidence(engine, left.id)
  );
  const pushed = coded && (await recordPushedHead(engine, coded));
  const taken = new Set([pushed?.id, evidenced?.id]);
  const [talked] = tasks
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => countRuns(engine, right.id) - countRuns(engine, left.id));
  const [, chatty] = tasks
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => countRuns(engine, right.id) - countRuns(engine, left.id));
  const status = tasks.find(
    (entry) => !taken.has(entry.id) && entry.id !== talked?.id && entry.id !== chatty?.id
  );
  for (const task of [talked, chatty]) if (task) seedMessages(studio, task);
  const shares = [
    pushed &&
      (await createPreviewShare(studio, pushed, 'A shared task with an open pull request, with Code')),
    evidenced &&
      evidenced.id !== pushed?.id &&
      (await createPreviewShare(studio, evidenced, 'A shared task with its evidence')),
    status &&
      (await createPreviewShare(studio, status, 'A task shared as Status, the status card', 'status')),
    talked &&
      (await createPreviewShare(
        studio,
        talked,
        'A task shared as Standard, with the agents’ live output in Chat',
        'standard'
      )),
    chatty &&
      (await createPreviewShare(
        studio,
        chatty,
        'A task shared as Full access, with your messages in Chat too',
        'full'
      )),
  ];
  return shares.filter((share): share is PreviewShare => Boolean(share));
}

async function createServicePreview(
  studio: Awaited<ReturnType<typeof startMachine>>
): Promise<{ preview: ServicePreview; shared: SharedService }> {
  const { engine, terminals } = studio;
  const { services } = terminals.snapshot();
  const task = Object.values(engine.state.tasks).find(
    (entry) =>
      entry.repoId &&
      entry.worktreePath &&
      !isTaskSettled(entry) &&
      services.some((each) => each.projectId === entry.projectId && each.name === 'web')
  );
  const service = services.find((entry) => entry.projectId === task?.projectId && entry.name === 'web');
  if (!(task && service)) throw new Error('No seeded task has a web service to share.');
  const shared: SharedService = { engine, terminals, serviceId: service.id, taskId: task.id };
  startSharedService(shared);
  await engine.dispatch({ type: 'preview.share', taskId: task.id, serviceId: service.id, limit: 'none' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const preview = engine.state.tasks[task.id]?.previews?.find((entry) => entry.serviceId === service.id);
    const run = terminals
      .snapshot()
      .terminals.find((entry) => entry.serviceId === service.id && entry.taskId === task.id);
    if (preview?.url && run?.remoteUrl)
      return {
        preview: {
          url: preview.url,
          privateUrl: run.remoteUrl,
          handle: task.handle ?? task.id,
          port: studio.machine.port,
        },
        shared,
      };
    if (preview?.failure) throw new Error(`Sharing the web service failed: ${preview.failure}`);
    await Bun.sleep(100);
  }
  throw new Error('Sharing the web service did not finish.');
}

function startSharedService(shared: SharedService) {
  const { engine, terminals, serviceId, taskId } = shared;
  const run = resolveServiceRunIn(engine.state, terminals.findService(serviceId), taskId, terminals);
  if (!run) throw new Error('The shared web service cannot run in its task.');
  terminals.startService(serviceId, run);
}

function createPreviewWorld(machines: Machine[]): CloudWorld {
  return {
    store: {
      selectInstance: (id: string) => {
        const machine = machines.find((entry) => entry.id === id);
        return Promise.resolve(
          machine ? { online: 1, last_seen_at: Date.now(), connect_key: machine.connectKey } : null
        );
      },
    },
    fetch: (target: string, init?: RequestInit) => {
      const url = new URL(target);
      const machine = machines.find((entry) => url.host === `t-${entry.id}.shinsa.dev`);
      if (!machine) return Promise.reject(new Error('No such tunnel.'));
      const headers = new Headers(init?.headers);
      headers.set('cf-connecting-ip', '127.0.0.1');
      return fetch(`http://127.0.0.1:${machine.port}${url.pathname}${url.search}`, { ...init, headers });
    },
    now: Date.now,
    config: { previewOrigin: PREVIEW_ZONE },
  } as unknown as CloudWorld;
}

function upgradePreview(request: Request, url: URL, machines: Machine[], server: Bun.Server<TunnelData>) {
  const address = parsePreviewHost(url.host, PREVIEW_ZONE);
  const machine = machines.find((entry) => entry.id === address?.instanceId);
  const key = readCookie(request, PREVIEW_COOKIE);
  const access = readCookie(request, PREVIEW_ACCESS_COOKIE);
  if (!(address && machine && (key || access))) return new Response('Not shared', { status: 404 });
  const path = `${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`;
  const data: TunnelData = {
    machine,
    path,
    upstream: null,
    pending: [],
    headers: {
      ...(key ? { [PREVIEW_KEY_HEADER]: key } : {}),
      ...(access ? { [PREVIEW_ACCESS_HEADER]: access } : {}),
    },
  };
  if (server.upgrade(request, { data })) return undefined;
  return new Response('Upgrade failed', { status: 400 });
}

async function respondEnroll(machine: Machine, url: URL) {
  await machine.remote.createLink();
  const { link } = machine.remote.snapshot();
  const target = link?.url ?? REMOTE_PATHS.app;
  return Response.redirect(url.searchParams.has('on') ? target.replace('#', '?on=machine#') : target, 302);
}

interface SandboxSection {
  title: string;
  links: { label: string; url: string }[];
}

interface SandboxPageModule {
  serializeSandboxPage: (sections: SandboxSection[], stylesheet: string) => string;
}

const SANDBOX_PATH = '/sandbox';

const SERVICE_TOGGLE = new RegExp(`^${SANDBOX_PATH}/service/(start|stop)$`);

const ENROLL = new RegExp(`^${SANDBOX_PATH}/enroll/([a-z]+)$`);

const TUNNEL = new RegExp(`^${SANDBOX_PATH}/tunnel/([a-z]+)(/share|/team)?$`);

async function toggleSharedService(shared: SharedService, url: URL) {
  if (url.pathname.endsWith('/start')) startSharedService(shared);
  if (url.pathname.endsWith('/stop')) await shared.terminals.stopService(shared.serviceId, shared.taskId);
  return Response.redirect(`${ORIGIN}${SANDBOX_PATH}`, 303);
}

function respondToggle(shared: SharedService, url: URL) {
  if (SERVICE_TOGGLE.test(url.pathname)) return toggleSharedService(shared, url);
  if (TEAMMATE_TOGGLE.test(url.pathname)) return toggleTeammate(url);
  return null;
}

function respondPreviewHost(
  request: Request,
  url: URL,
  machines: Machine[],
  world: CloudWorld,
  server: Bun.Server<TunnelData>
) {
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket')
    return upgradePreview(request, url, machines, server);
  return respondPreview(request, url, world);
}

function readCookie(request: Request, cookie: string) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookie) return rest.join('=');
  }
  return null;
}

async function respondPreviewOpen(url: URL, machines: Machine[]) {
  const target = new URL(url.searchParams.get('url') ?? '', PREVIEW_ZONE);
  const address = parsePreviewHost(target.host, PREVIEW_ZONE);
  const machine = machines.find((entry) => entry.id === address?.instanceId);
  if (!(address && machine)) return new Response('Not a service of yours', { status: 404 });
  const token = await createPreviewAccessToken(machine.connectKey, {
    ...address,
    userId: USER.id,
    expiresAt: Date.now() + PREVIEW_OPEN_TTL_MS,
  });
  target.searchParams.set(PREVIEW_ACCESS_PARAM, token);
  return Response.redirect(target.href, 303);
}

function respondShareConnect(match: RegExpExecArray, machines: Machine[]) {
  const machine = machines.find((entry) => entry.id === match[1]);
  if (!machine)
    return Response.json(
      { error: { code: 'not_found', message: 'This task is no longer shared, or the link is wrong.' } },
      { status: 404 }
    );
  const answer: ShareConnectResponse = {
    url: `ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${machine.id}`,
    online: true,
  };
  return Response.json(answer);
}

function findRemoteStylesheet() {
  const html = readFileSync(join(REMOTE_WEB, 'index.html'), 'utf8');
  const href = /<link rel="stylesheet"[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
  if (!href) throw new Error('The remote build has no stylesheet.');
  return href;
}

function respondStatic(pathname: string) {
  const relative = pathname.replace(/^\/+/, '');
  const file = Bun.file(join(REMOTE_WEB, relative));
  if (relative && !relative.includes('..') && existsSync(join(REMOTE_WEB, relative)) && file.size > 0)
    return new Response(file);
  return new Response(Bun.file(join(REMOTE_WEB, 'index.html')), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function listSandboxSections(
  machines: Machine[],
  teammate: Machine,
  shares: PreviewShare[],
  teamTask: string | null,
  preview: ServicePreview,
  duplicate: { duplicate: string; original: string | null }
): SandboxSection[] {
  const studioPort = machines[0]?.port;
  return [
    {
      title: 'Each machine’s own app',
      links: machines.flatMap((machine) => [
        { label: `${machine.name}: Home`, url: `http://${HOST}:${machine.port}/` },
        { label: `${machine.name}: Settings`, url: `http://${HOST}:${machine.port}/settings` },
      ]),
    },
    {
      title: 'The remote dashboard, always signed in',
      links: [
        { label: 'The merged dashboard', url: `${ORIGIN}${REMOTE_PATHS.app}` },
        { label: 'All tasks, each with its machine', url: `${ORIGIN}/tasks` },
        { label: 'Settings, with Machines', url: `${ORIGIN}/settings` },
      ],
    },
    {
      title: 'Adding a device and pairing',
      links: [
        ...machines.flatMap((machine) => [
          {
            label: `Add this device to ${machine.name}`,
            url: `${ORIGIN}${SANDBOX_PATH}/enroll/${machine.id}`,
          },
          {
            label: `Add this device to ${machine.name} as the machine it sits on`,
            url: `${ORIGIN}${SANDBOX_PATH}/enroll/${machine.id}?on=machine`,
          },
        ]),
        { label: 'Approve a pairing (code K7PQ)', url: `${ORIGIN}${REMOTE_PATHS.pairPage}?code=K7PQ` },
        {
          label: 'Sign in as the iPhone app does (answers shinsa://signed-in?code=preview)',
          url: `${ORIGIN}${REMOTE_PATHS.signIn}?client=${REMOTE_NATIVE_CLIENT}&redirect=shinsa://signed-in`,
        },
      ],
    },
    {
      title: 'Shared tasks, live links with no sign-in',
      links: [
        ...shares.flatMap((share) => [
          { label: share.label, url: share.url },
          {
            label: `The same task, ${share.handle}, on Studio`,
            url: `http://${HOST}:${share.port}/tasks/${share.handle}`,
          },
        ]),
        {
          label: 'A share link that no longer works',
          url: serializeShareUrl(ORIGIN, createShareLink('studio')),
        },
      ],
    },
    {
      title: 'The shared web service',
      links: [
        {
          label: `${preview.handle} on Studio, with its Services, Share preview and Stop sharing`,
          url: `http://${HOST}:${preview.port}/tasks/${preview.handle}`,
        },
        {
          label: `The shared preview of ${preview.handle}’s web service, with live updates`,
          url: preview.url,
        },
        {
          label: 'Stop the web service (the preview then says it is not running)',
          url: `${ORIGIN}${SANDBOX_PATH}/service/stop`,
        },
        { label: 'Start the web service again', url: `${ORIGIN}${SANDBOX_PATH}/service/start` },
        ...(preview.privateUrl
          ? [
              {
                label: `${preview.handle} through remote access: Open on its web service goes to the private address`,
                url: `${ORIGIN}/tasks/${preview.handle}`,
              },
              {
                label: `${preview.handle}’s web service at its private address, as Open goes there`,
                url: `${ORIGIN}${REMOTE_PATHS.previewOpen}?${new URLSearchParams({ url: preview.privateUrl })}`,
              },
              {
                label: 'The private address without signing in through Open (not shared)',
                url: preview.privateUrl,
              },
            ]
          : []),
        {
          label: 'A preview link that no longer works',
          url: `http://${'a'.repeat(32)}.localhost:${PORT}/`,
        },
      ],
    },
    {
      title: 'Teams',
      links: [
        {
          label: `Studio: the focus menu’s Teams section, then ${TEAM.name}, shows Kai’s tasks beside yours`,
          url: `http://${HOST}:${studioPort}/tasks`,
        },
        {
          label: 'Studio: Settings, Teams, with Inês asking to join',
          url: `http://${HOST}:${studioPort}/settings`,
        },
        {
          label: 'Take Kai’s MacBook offline (Studio keeps its tasks as Offline)',
          url: `${ORIGIN}${SANDBOX_PATH}/teammate/offline`,
        },
        { label: 'Bring Kai’s MacBook back', url: `${ORIGIN}${SANDBOX_PATH}/teammate/online` },
        ...(teamTask
          ? [
              {
                label: 'One of Kai’s tasks on Studio, read-only',
                url: `http://${HOST}:${studioPort}${teamTask}`,
              },
            ]
          : []),
        {
          label: `Studio: ${duplicate.duplicate}, closed as a duplicate of Kai’s task`,
          url: `http://${HOST}:${studioPort}/tasks/${duplicate.duplicate}`,
        },
        ...(duplicate.original
          ? [
              {
                label: `${teammate.name}: ${duplicate.original}, which shows the task kept over on Studio`,
                url: `http://${HOST}:${teammate.port}/tasks/${duplicate.original}`,
              },
            ]
          : []),
        {
          label: `${teammate.name}: Settings, Teams. Take Paywalls out of ${TEAM.name}, and Kai’s tasks leave Studio’s list at once`,
          url: `http://${HOST}:${teammate.port}/settings`,
        },
        {
          label:
            'The team’s join link, which gives this browser the team key so the dashboard opens Kai’s tasks too',
          url: resolveTeamJoinUrl({ teamId: TEAM.id, invite: TEAM_INVITE, key: TEAM_KEY }, ORIGIN),
        },
      ],
    },
  ];
}

async function createConnect(machine: Machine): Promise<ConnectResponse> {
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: USER.id,
    expiresAt,
  });
  return {
    url: `ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

async function respondConnect(machine: Machine) {
  return Response.json(await createConnect(machine));
}

function respondNativeSignIn(url: URL) {
  const redirect = URL.parse(url.searchParams.get('redirect') ?? '');
  if (!redirect || !REMOTE_NATIVE_REDIRECT_SCHEMES.some((scheme) => scheme === redirect.protocol))
    return Response.json(
      {
        error: { code: 'invalid_redirect', message: 'The app can only be sent back to a shinsa:// address.' },
      },
      { status: 400 }
    );
  redirect.searchParams.set('code', 'preview');
  return new Response(null, { status: 302, headers: { location: redirect.toString() } });
}

const INVITES = new Map<string, string>();

function respondInviteCreate(request: Request, machines: Machine[]) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer preview-/, '');
  const machine = machines.find((entry) => entry.id === bearer);
  if (!machine) return Response.json({ error: { code: 'revoked', message: 'Not paired.' } }, { status: 401 });
  const token = crypto.randomUUID().replaceAll('-', '');
  INVITES.set(token, machine.id);
  const answer: InviteCreateResponse = { token };
  return Response.json(answer);
}

async function respondInviteAccept(request: Request, machines: Machine[]) {
  const { token } = (await request.json()) as { token?: string };
  const machine = machines.find((entry) => entry.id === INVITES.get(token ?? ''));
  if (!machine)
    return Response.json(
      {
        error: {
          code: 'invite_invalid',
          message: 'This invite link was turned off. Ask the machine’s owner for a new one.',
        },
      },
      { status: 404 }
    );
  const answer: InviteAcceptResponse = {
    instanceId: machine.id,
    name: machine.name,
    owner: USER,
    user: USER,
    connect: await createConnect(machine),
  };
  return Response.json(answer);
}

async function respondTeamConnect(request: Request, viewer: RemoteUser, teammates: Machine[]) {
  const { instanceId } = (await request.json()) as { instanceId?: string };
  const target = teammates.find((entry) => entry.id === instanceId);
  if (!target)
    return Response.json(
      { error: { code: 'not_found', message: 'That machine is not in this team.' } },
      { status: 404 }
    );
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(target.connectKey, {
    instanceId: target.id,
    userId: viewer.id,
    expiresAt,
  });
  const answer: ConnectResponse = {
    url: resolveTeamChannelUrl(`ws://${HOST}:${PORT}${SANDBOX_PATH}/tunnel/${target.id}`, token),
    expiresAt,
  };
  return Response.json(answer);
}

function selectCallerOwner(request: Request) {
  const id = (request.headers.get('authorization') ?? '').replace(/^Bearer preview-/, '');
  return MACHINE_OWNERS[id] ?? null;
}

function respondTeams(request: Request, url: URL, teammates: Machine[]) {
  const { pathname } = url;
  if (pathname === REMOTE_PATHS.teams) return Response.json(resolvePreviewTeams(USER));
  if (pathname === REMOTE_PATHS.teamJoin) {
    const answer: TeamJoinResponse = {
      teamId: TEAM.id,
      name: TEAM.name,
      owner: TEAM.owner,
      status: 'member',
    };
    return Response.json(answer);
  }
  if (pathname === REMOTE_PATHS.teamPreview) {
    const answer: TeamPreviewResponse = { name: TEAM.name, owner: TEAM.owner };
    return Response.json(answer);
  }
  if (pathname === `${REMOTE_PATHS.teams}/${TEAM.id}/connect`)
    return respondTeamConnect(request, USER, teammates);
  const owner = selectCallerOwner(request);
  if (owner && pathname === `${REMOTE_PATHS.machineTeams}/${TEAM.id}/connect`)
    return respondTeamConnect(request, owner, teammates);
  if (owner && pathname.startsWith(`${REMOTE_PATHS.machineTeams}/`)) return Response.json({ ok: true });
  return null;
}

function respondSession(request: Request, url: URL) {
  const { pathname } = url;
  if (pathname === REMOTE_PATHS.session) return Response.json({ user: USER });
  if (pathname === REMOTE_PATHS.signIn && url.searchParams.get('client') === REMOTE_NATIVE_CLIENT)
    return respondNativeSignIn(url);
  if (pathname === REMOTE_PATHS.signInToken && request.method === 'POST') {
    const answer: NativeSignInTokenResponse = { token: 'preview', user: USER };
    return Response.json(answer);
  }
  if (pathname === REMOTE_PATHS.signIn)
    return Response.redirect(`${ORIGIN}${url.searchParams.get('return') ?? REMOTE_PATHS.app}`, 302);
  if (pathname === REMOTE_PATHS.signOut) return Response.json({});
  return null;
}

async function respondDashboard(request: Request, url: URL, machines: Machine[], teammates: Machine[]) {
  const { pathname } = url;
  const team = respondTeams(request, url, teammates);
  if (team) return team;
  const session = respondSession(request, url);
  if (session) return session;
  if (pathname === REMOTE_PATHS.previewOpen) return respondPreviewOpen(url, machines);
  if (pathname === REMOTE_PATHS.instances) return Response.json(await listInstances(machines));
  if (pathname.startsWith(`${REMOTE_PATHS.pairs}/`)) {
    const [studio] = machines;
    if (pathname.endsWith('/approve')) return Response.json({ instanceId: studio?.id, name: studio?.name });
    return Response.json({
      claimCode: 'K7PQ',
      name: studio?.name ?? 'Studio',
      fingerprint: await resolveKeyFingerprint(studio?.publicKey ?? ''),
      expiresAt: Date.now() + 10 * 60_000,
      claimed: false,
    });
  }
  const machine = machines.find((entry) => pathname.startsWith(`${REMOTE_PATHS.instances}/${entry.id}/`));
  if (machine && pathname.endsWith('/connect') && request.method === 'POST') return respondConnect(machine);
  if (machine && (pathname.endsWith('/remove') || pathname.endsWith('/leave'))) return Response.json({});
  if (pathname === REMOTE_PATHS.machineInvites) return respondInviteCreate(request, machines);
  if (pathname === REMOTE_PATHS.inviteAccept) return respondInviteAccept(request, machines);
  if (pathname === REMOTE_PATHS.machineRequester) return Response.json(USER);
  if (pathname === REMOTE_PATHS.machineInviteRemove || pathname === REMOTE_PATHS.machineMemberRemove)
    return Response.json({ ok: true });
  return Response.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, { status: 404 });
}

interface TunnelData {
  machine: Machine;
  path: string;
  upstream: WebSocket | null;
  pending: (string | Uint8Array)[];
  headers?: Record<string, string>;
}

function openUpstream(socket: ServerWebSocket<TunnelData>) {
  const { machine, path } = socket.data;
  if (machine.id === 'kai') teammateLink.sockets.add(socket);
  const upstream = new WebSocket(`ws://127.0.0.1:${machine.port}${path}`, {
    headers: { origin: ORIGIN, 'cf-connecting-ip': '127.0.0.1', ...socket.data.headers },
  } as unknown as string[]);
  upstream.binaryType = 'arraybuffer';
  upstream.addEventListener('open', () => {
    for (const message of socket.data.pending.splice(0)) upstream.send(message);
  });
  upstream.addEventListener('message', (event) => {
    socket.send(typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer));
  });
  upstream.addEventListener('close', (event) => socket.close(event.code === 1005 ? 1000 : event.code));
  socket.data.upstream = upstream;
}

async function main() {
  if (!existsSync(join(REMOTE_WEB, 'index.html')) || !existsSync(join(LOCAL_WEB, 'index.html')))
    throw new Error(
      'Build the web app first: bun run --cwd apps/web build && bun run --cwd apps/web build:remote'
    );
  rmSync(SANDBOX_DIR, { recursive: true, force: true });
  const studioData = seedStudio();
  const laptopData = prepareMachine('laptop');
  const studio = await startMachine('studio', 'Studio', studioData);
  const laptop = await startMachine('laptop', 'Laptop', laptopData);
  await seedProject(laptop.engine, laptopData, { repo: 'website', project: 'Website', tasks: LAPTOP_TASKS });
  const teammateData = prepareMachine('kai');
  const teammate = await startMachine('kai', 'Kai’s MacBook', teammateData);
  teammateLink.signingKey = (await teammate.machine.remote.store.resolveSigningKey()).publicKey;
  const paywalls = await seedProject(teammate.engine, teammateData, {
    repo: 'paywalls',
    project: 'Paywalls',
    tasks: TEAMMATE_TASKS,
  });
  await shareProjectWithTeam(teammate.engine, paywalls.projectId ?? undefined);
  const studioProject = selectBusiestProject(studio.engine);
  await shareProjectWithTeam(studio.engine, studioProject);
  const [teamTask] = Object.values(teammate.engine.state.tasks);
  const keptOver = await seedTeammateDuplicate(studio.engine, studioProject, teamTask);
  const machines = [studio.machine, laptop.machine];
  const teammates = [...machines, teammate.machine];
  const shares = await createPreviewShares(studio);
  const teamTaskPath = teamTask ? `/teams/${TEAM.id}/kai/${teamTask.id}` : null;
  const { preview, shared } = await createServicePreview(studio);
  const { serializeSandboxPage }: SandboxPageModule = await import(
    join(ROOT, 'apps/web/src/components/sandbox/sandbox-page.tsx')
  );
  const page = serializeSandboxPage(
    listSandboxSections(machines, teammate.machine, shares, teamTaskPath, preview, {
      duplicate: keptOver.handle ?? keptOver.id,
      original: teamTask?.handle ?? null,
    }),
    findRemoteStylesheet()
  );
  const world = createPreviewWorld(machines);
  Bun.serve<TunnelData>({
    port: PORT,
    hostname: HOST,
    fetch(request, server) {
      const url = new URL(request.url);
      if (isPreviewHost(url.host, PREVIEW_ZONE))
        return respondPreviewHost(request, url, machines, world, server);
      if (url.pathname === SANDBOX_PATH)
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      const toggled = respondToggle(shared, url);
      if (toggled) return toggled;
      const share = SHARE_CONNECT.exec(url.pathname);
      if (share && request.method === 'POST') return respondShareConnect(share, machines);
      const enroll = ENROLL.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) return respondEnroll(enrolling, url);
      const tunnel = TUNNEL.exec(url.pathname);
      const machine = teammates.find((entry) => entry.id === tunnel?.[1]);
      if (machine?.id === 'kai' && !teammateLink.online) return new Response('Offline', { status: 502 });
      if (machine) {
        const token = encodeURIComponent(url.searchParams.get(REMOTE_CONNECT_PARAM) ?? '');
        const channels: Record<string, string> = {
          '/share': `${SHARE_CHANNEL_PATH}${url.search}`,
          '/team': `${TEAM_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${token}`,
        };
        const path = channels[tunnel?.[2] ?? ''] ?? `${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${token}`;
        if (server.upgrade(request, { data: { machine, path, upstream: null, pending: [] } }))
          return undefined;
        return new Response('Upgrade failed', { status: 400 });
      }
      if (url.pathname.startsWith('/__remote/')) return respondDashboard(request, url, machines, teammates);
      return respondStatic(url.pathname);
    },
    websocket: {
      open: openUpstream,
      message(socket, message) {
        const payload = typeof message === 'string' ? message : new Uint8Array(message);
        const { upstream } = socket.data;
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(payload);
        else socket.data.pending.push(payload);
      },
      close(socket) {
        teammateLink.sockets.delete(socket);
        socket.data.upstream?.close();
      },
    },
  });
  console.info(`The sandbox: ${ORIGIN}${SANDBOX_PATH}`);
}

await main();
