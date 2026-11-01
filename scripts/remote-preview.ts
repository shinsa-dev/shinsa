import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { Transcripts } from '../apps/engine/src/agents/index.ts';
import { ProviderRegistry } from '../apps/engine/src/agents/providers/index.ts';
import { createQuickCalls } from '../apps/engine/src/agents/quick/index.ts';
import { ConfigStore, resolveConfig } from '../apps/engine/src/config/index.ts';
import { normalizeRemote } from '../apps/engine/src/git/repo.ts';
import { startServer } from '../apps/engine/src/http/index.ts';
import { Onboarding } from '../apps/engine/src/onboarding/index.ts';
import { ControlClient, REMOTE_FILE, Remote } from '../apps/engine/src/remote/index.ts';
import { createPlacementAsker } from '../apps/engine/src/remote/placement.ts';
import { ShareClock } from '../apps/engine/src/remote/share-clock.ts';
import { type ShareGitHub, Shares } from '../apps/engine/src/remote/shares.ts';
import { Roots } from '../apps/engine/src/repos/index.ts';
import { Engine } from '../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../apps/engine/src/store/index.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  createSettings,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  isTaskSettled,
  type MachineResources,
  type NativeSignInTokenResponse,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteUser,
  type Repo,
  resolveKeyFingerprint,
  SHARE_CHANNEL_PATH,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  type ShareConnectResponse,
  type ShareLink,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
} from '../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(Bun.env.PORT ?? 5195);
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const PREVIEW_DIR = Bun.env.SHINSA_REMOTE_PREVIEW_DIR ?? join('/tmp', `shinsa-remote-preview-${PORT}`);
const REMOTE_WEB = join(ROOT, 'apps/web/dist-remote');
const LOCAL_WEB = join(ROOT, 'apps/web/dist');
const USER: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };
const PLACE = createPlacementAsker(createQuickCalls(new ProviderRegistry(), createSettings).classify);

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

const SHARE_CONNECT = new RegExp(`^${REMOTE_PATHS.shares}/([a-z]+)/connect$`);

function createShareLink(instanceId: string): ShareLink {
  const random = (bytes: number) => serializeBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
  return { instanceId, shareId: random(SHARE_ID_BYTES), key: random(SHARE_KEY_BYTES) };
}

function seedStudio() {
  const seedDir = join(PREVIEW_DIR, 'studio');
  const seeded = Bun.spawnSync(['bun', join(ROOT, 'scripts/seed.ts')], {
    env: { ...Bun.env, SHINSA_SEED_DIR: seedDir },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (seeded.exitCode !== 0) throw new Error('Seeding Studio failed.');
  return join(seedDir, 'data');
}

function prepareLaptop() {
  const dataDir = join(PREVIEW_DIR, 'laptop', 'data');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [], onboardedAt: Date.now() }, null, 2)}\n`
  );
  return dataDir;
}

function writeRemoteFile(dataDir: string, id: string, connectKey: string) {
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
      owner: USER.login,
      devices: [],
      access: { owner: USER, members: [] },
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

async function startMachine(id: string, name: string, dataDir: string) {
  const connectKey = serializeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  writeRemoteFile(dataDir, id, connectKey);
  const config = resolveConfig({
    ...Bun.env,
    SHINSA_DATA_DIR: dataDir,
    SHINSA_PORT: '0',
    SHINSA_REMOTE_ORIGIN: ORIGIN,
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
  const evidence = new EvidenceStore(config.evidenceDir);
  const shares = new Shares({
    engine,
    remote,
    evidence,
    github: createPreviewGitHub(engine),
  });
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
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
  });
  engine.onEffect(async (effect, context) => {
    if (effect.kind === 'share.link') await shares.link(effect.taskId, context);
  });
  remote.subscribe(() => {
    setTimeout(() => {
      for (const request of remote.snapshot().requests)
        remote.acceptRequest(request.id).catch((error: unknown) => console.error(error));
    });
  });
  engine.start();
  new ShareClock(engine).start();
  const key = await remote.store.resolveMachineKey();
  const machine: Machine = {
    id,
    name,
    remote,
    port: http.server.port ?? 0,
    connectKey,
    publicKey: key.publicKey,
  };
  return { machine, engine, evidence };
}

async function seedLaptop(engine: Engine, dataDir: string) {
  const path = join(dataDir, '..', 'website');
  mkdirSync(path, { recursive: true });
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'website', path, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: 'Website',
  });
  const [repo] = Object.values(engine.state.repos);
  if (!repo) throw new Error('Registering the Laptop repository failed.');
  for (const task of LAPTOP_TASKS) {
    await engine.dispatch({ type: 'task.create', request: task.request, repoId: repo.id });
    const created = Object.values(engine.state.tasks).find((entry) => entry.request === task.request);
    if (!created) throw new Error('Creating a Laptop task failed.');
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
  label: string
): Promise<PreviewShare | null> {
  const seeded = task.repoId ? studio.engine.state.repos[task.repoId] : undefined;
  if (!seeded) return null;
  await normalizeSeedRemote(studio.engine, seeded);
  const url = serializeShareUrl(ORIGIN, createShareLink(studio.machine.id));
  if (!task.share) await studio.engine.dispatch({ type: 'task.share', taskId: task.id, limit: 'none' });
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
  const shares = [
    pushed &&
      (await createPreviewShare(studio, pushed, 'A shared task with an open pull request, with Code')),
    evidenced &&
      evidenced.id !== pushed?.id &&
      (await createPreviewShare(studio, evidenced, 'A shared task with its evidence')),
  ];
  return shares.filter((share): share is PreviewShare => Boolean(share));
}

function respondShareConnect(match: RegExpExecArray, machines: Machine[]) {
  const machine = machines.find((entry) => entry.id === match[1]);
  if (!machine)
    return Response.json(
      { error: { code: 'not_found', message: 'This task is no longer shared, or the link is wrong.' } },
      { status: 404 }
    );
  const answer: ShareConnectResponse = {
    url: `ws://${HOST}:${PORT}/__preview/tunnel/${machine.id}`,
    online: true,
  };
  return Response.json(answer);
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

function respondIndex(machines: Machine[], shares: PreviewShare[]) {
  const links = [
    ['Sign in (the stand-in is always signed in, so this shows the dashboard)', REMOTE_PATHS.app],
    [
      'Sign in as the iPhone app does (answers shinsa://signed-in?code=preview, which the token path takes)',
      `${REMOTE_PATHS.signIn}?client=${REMOTE_NATIVE_CLIENT}&redirect=shinsa://signed-in`,
    ],
    ...machines.map((machine) => [
      `Add this device to ${machine.name} (accepted at once, then the dashboard opens)`,
      `/__preview/enroll/${machine.id}`,
    ]),
    ...machines.map((machine) => [
      `Add this device to ${machine.name} as the machine it sits on (it shows as This machine)`,
      `/__preview/enroll/${machine.id}?on=machine`,
    ]),
    ['The merged dashboard of every machine this device was added to', REMOTE_PATHS.app],
    ['All tasks, each with its machine', '/tasks'],
    ['Settings, with Machines', '/settings'],
    ['Approving a pairing (code K7PQ)', `${REMOTE_PATHS.pairPage}?code=K7PQ`],
    ...shares.flatMap((share) => [
      [`${share.label} (a live link, no sign-in)`, share.url],
      [
        `The same task, ${share.handle}, as you see it on Studio`,
        `http://${HOST}:${share.port}/tasks/${share.handle}`,
      ],
    ]),
    ['A share link that no longer works', serializeShareUrl(ORIGIN, createShareLink('studio'))],
    ...machines.map((machine) => [
      `${machine.name}'s own app on the machine: Settings, Remote access`,
      `http://${HOST}:${machine.port}/settings`,
    ]),
  ];
  const items = links.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join('');
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Remote access preview</title><body style="font:14px system-ui;margin:40px;max-width:640px"><h1 style="font-size:18px">Remote access preview</h1><p>Add this device to Studio and Laptop first: each machine accepts it at once and the dashboard opens. Then open Settings.</p><ol>${items}</ol></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

async function createConnect(machine: Machine): Promise<ConnectResponse> {
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: USER.id,
    expiresAt,
  });
  return {
    url: `ws://${HOST}:${PORT}/__preview/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
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

async function respondDashboard(request: Request, url: URL, machines: Machine[]) {
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
}

function openUpstream(socket: ServerWebSocket<TunnelData>) {
  const { machine, path } = socket.data;
  const upstream = new WebSocket(`ws://127.0.0.1:${machine.port}${path}`, {
    headers: { origin: ORIGIN, 'cf-connecting-ip': '127.0.0.1' },
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
  rmSync(PREVIEW_DIR, { recursive: true, force: true });
  const studioData = seedStudio();
  const laptopData = prepareLaptop();
  const studio = await startMachine('studio', 'Studio', studioData);
  const laptop = await startMachine('laptop', 'Laptop', laptopData);
  await seedLaptop(laptop.engine, laptopData);
  const machines = [studio.machine, laptop.machine];
  const shares = await createPreviewShares(studio);
  Bun.serve<TunnelData>({
    port: PORT,
    hostname: HOST,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/__preview') return respondIndex(machines, shares);
      const share = SHARE_CONNECT.exec(url.pathname);
      if (share && request.method === 'POST') return respondShareConnect(share, machines);
      const enroll = /^\/__preview\/enroll\/([a-z]+)$/.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) {
        await enrolling.remote.createLink();
        const { link } = enrolling.remote.snapshot();
        const onMachine = url.searchParams.has('on');
        const target = link?.url ?? REMOTE_PATHS.app;
        return Response.redirect(onMachine ? target.replace('#', '?on=machine#') : target, 302);
      }
      const tunnel = /^\/__preview\/tunnel\/([a-z]+)(\/share)?$/.exec(url.pathname);
      const machine = machines.find((entry) => entry.id === tunnel?.[1]);
      if (machine) {
        const path = tunnel?.[2]
          ? `${SHARE_CHANNEL_PATH}${url.search}`
          : `${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(url.searchParams.get(REMOTE_CONNECT_PARAM) ?? '')}`;
        if (server.upgrade(request, { data: { machine, path, upstream: null, pending: [] } }))
          return undefined;
        return new Response('Upgrade failed', { status: 400 });
      }
      if (url.pathname.startsWith('/__remote/')) return respondDashboard(request, url, machines);
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
        socket.data.upstream?.close();
      },
    },
  });
  console.info(`Remote access preview: ${ORIGIN}/__preview`);
  for (const machine of machines)
    console.info(`${machine.name}'s own app: http://${HOST}:${machine.port}/settings`);
}

await main();
