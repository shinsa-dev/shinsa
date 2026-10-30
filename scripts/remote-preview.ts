import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { Transcripts } from '../apps/engine/src/agents/index.ts';
import { ConfigStore, resolveConfig } from '../apps/engine/src/config/index.ts';
import { startServer } from '../apps/engine/src/http/index.ts';
import { Onboarding } from '../apps/engine/src/onboarding/index.ts';
import { ControlClient, REMOTE_FILE, Remote } from '../apps/engine/src/remote/index.ts';
import { Roots } from '../apps/engine/src/repos/index.ts';
import { Engine } from '../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../apps/engine/src/store/index.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  createConnectToken,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  REMOTE_PATHS,
  type RemoteInstance,
  resolveKeyFingerprint,
  serializeBase64Url,
} from '../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(Bun.env.PORT ?? 5195);
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const PREVIEW_DIR = Bun.env.SHINSA_REMOTE_PREVIEW_DIR ?? join('/tmp', `shinsa-remote-preview-${PORT}`);
const REMOTE_WEB = join(ROOT, 'apps/web/dist-remote');
const LOCAL_WEB = join(ROOT, 'apps/web/dist');
const USER = { id: '1', login: 'you', avatarUrl: null };

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
    JSON.stringify({ version: 1, credentials, enabled: true, owner: USER.login, devices: [] })
  );
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
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
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
  });
  const key = await remote.store.resolveMachineKey();
  const machine: Machine = {
    id,
    name,
    remote,
    port: http.server.port ?? 0,
    connectKey,
    publicKey: key.publicKey,
  };
  return { machine, engine };
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
    }))
  );
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

function respondIndex(machines: Machine[]) {
  const links = [
    ['Sign in (the stand-in is always signed in, so this shows the dashboard)', REMOTE_PATHS.app],
    ...machines.map((machine) => [
      `Add this device to ${machine.name} (a fresh one-time link)`,
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
    ...machines.map((machine) => [
      `${machine.name}'s own app on the machine: Settings, Remote access`,
      `http://${HOST}:${machine.port}/settings`,
    ]),
  ];
  const items = links.map(([label, href]) => `<li><a href="${href}">${label}</a></li>`).join('');
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Remote access preview</title><body style="font:14px system-ui;margin:40px;max-width:640px"><h1 style="font-size:18px">Remote access preview</h1><p>Add this device to each machine first, then open the dashboard.</p><ol>${items}</ol></body>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

async function respondConnect(machine: Machine) {
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: USER.id,
    expiresAt,
  });
  return Response.json({
    url: `ws://${HOST}:${PORT}/__preview/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    expiresAt,
  });
}

async function respondDashboard(request: Request, url: URL, machines: Machine[]) {
  const { pathname } = url;
  if (pathname === REMOTE_PATHS.session) return Response.json({ user: USER });
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
  if (machine && pathname.endsWith('/remove')) return Response.json({});
  return Response.json({ error: { code: 'not_found', message: 'No such endpoint.' } }, { status: 404 });
}

interface TunnelData {
  machine: Machine;
  token: string;
  upstream: WebSocket | null;
  pending: (string | Uint8Array)[];
}

function openUpstream(socket: ServerWebSocket<TunnelData>) {
  const { machine, token } = socket.data;
  const upstream = new WebSocket(
    `ws://127.0.0.1:${machine.port}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    { headers: { origin: ORIGIN, 'cf-connecting-ip': '127.0.0.1' } } as unknown as string[]
  );
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
  Bun.serve<TunnelData>({
    port: PORT,
    hostname: HOST,
    async fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname === '/__preview') return respondIndex(machines);
      const enroll = /^\/__preview\/enroll\/([a-z]+)$/.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) {
        const enrollment = await enrolling.remote.createEnrollment('This browser');
        const onMachine = url.searchParams.has('on');
        return Response.redirect(onMachine ? enrollment.url.replace('#', '?on=machine#') : enrollment.url, 302);
      }
      const tunnel = /^\/__preview\/tunnel\/([a-z]+)$/.exec(url.pathname);
      const machine = machines.find((entry) => entry.id === tunnel?.[1]);
      if (machine) {
        const token = url.searchParams.get(REMOTE_CONNECT_PARAM) ?? '';
        if (server.upgrade(request, { data: { machine, token, upstream: null, pending: [] } }))
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
