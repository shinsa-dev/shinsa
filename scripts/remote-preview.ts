import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ServerWebSocket } from 'bun';
import { isPreviewHost, PREVIEW_COOKIE, respondPreview } from '../apps/cloud/src/previews.ts';
import type { CloudWorld } from '../apps/cloud/src/world.ts';
import { Transcripts } from '../apps/engine/src/agents/index.ts';
import { ProviderRegistry } from '../apps/engine/src/agents/providers/index.ts';
import { createQuickCalls } from '../apps/engine/src/agents/quick/index.ts';
import { ConfigStore, resolveConfig } from '../apps/engine/src/config/index.ts';
import { normalizeRemote } from '../apps/engine/src/git/repo.ts';
import { startServer } from '../apps/engine/src/http/index.ts';
import { Onboarding } from '../apps/engine/src/onboarding/index.ts';
import { Handoffs } from '../apps/engine/src/remote/handoffs.ts';
import { ControlClient, REMOTE_FILE, Remote } from '../apps/engine/src/remote/index.ts';
import { createPlacementAsker } from '../apps/engine/src/remote/placement.ts';
import { Previews } from '../apps/engine/src/remote/previews.ts';
import { ShareClock } from '../apps/engine/src/remote/share-clock.ts';
import { createShareDescriber } from '../apps/engine/src/remote/share-describe.ts';
import { type ShareGitHub, Shares } from '../apps/engine/src/remote/shares.ts';
import { Roots } from '../apps/engine/src/repos/index.ts';
import { Engine } from '../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../apps/engine/src/store/index.ts';
import { Terminals } from '../apps/engine/src/terminals/index.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  type ConnectResponse,
  createConnectToken,
  createSettings,
  type InviteAcceptResponse,
  type InviteCreateResponse,
  isTaskSettled,
  type NativeSignInTokenResponse,
  PREVIEW_KEY_HEADER,
  parsePreviewHost,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
  type RemoteInstance,
  type RemoteMember,
  type RemoteUser,
  type Repo,
  resolveKeyFingerprint,
  resolvePreviewTunnelPath,
  SHARE_CHANNEL_PATH,
  SHARE_ID_BYTES,
  SHARE_KEY_BYTES,
  type ShareConnectResponse,
  type ShareLink,
  type SharePreset,
  serializeBase64Url,
  serializeShareUrl,
  type Task,
} from '../packages/core/src/index.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = Number(Bun.env.PORT ?? 5195);
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;
const PREVIEW_ZONE = `http://localhost:${PORT}`;
const PREVIEW_DIR = Bun.env.SHINSA_REMOTE_PREVIEW_DIR ?? join('/tmp', `shinsa-remote-preview-${PORT}`);
const REMOTE_WEB = join(ROOT, 'apps/web/dist-remote');
const LOCAL_WEB = join(ROOT, 'apps/web/dist');
const USER: RemoteUser = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };
const GUEST: RemoteUser = { id: 'preview-guest', login: 'kai', name: 'Kai Lane', avatarUrl: null };
const AS_COOKIE = 'shinsa_preview_as';
const GUEST_MACHINES = new Set<string>();
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
  handle: string;
  port: number;
}

interface DemoService {
  terminals: Terminals;
  serviceId: string;
  taskId: string;
}

const DEMO_COMMAND = `bun ${join(ROOT, 'scripts/remote-preview-demo.ts')}`;

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
  const previews = new Previews({
    engine,
    remote,
    services: terminals,
    origin: config.previewOrigin,
  });
  const handoffs = new Handoffs({ engine, remote });
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

function listInstances(machines: Machine[], user: RemoteUser): Promise<RemoteInstance[]> {
  const now = Date.now();
  const guest = user.id === GUEST.id;
  const listed = guest ? machines.filter((machine) => GUEST_MACHINES.has(machine.id)) : machines;
  return Promise.all(
    listed.map(async (machine) => ({
      id: machine.id,
      name: machine.name,
      fingerprint: await resolveKeyFingerprint(machine.publicKey),
      online: true,
      lastSeenAt: now,
      createdAt: now - 7 * 24 * 60 * 60 * 1000,
      owner: USER,
      role: guest ? 'guest' : 'owner',
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

function waitForHandoffLink(engine: Engine, taskId: string) {
  return new Promise<string>((done) => {
    const read = () =>
      engine.state.tasks[taskId]?.handoff?.url ?? engine.state.tasks[taskId]?.handoff?.failure;
    const now = read();
    if (now) return done(now);
    const stop = engine.subscribe(() => {
      const url = read();
      if (!url) return;
      stop();
      done(url);
    });
  });
}

function resolveClaimAs(claim: string) {
  if (!claim.startsWith('http')) return claim;
  const link = new URL(claim);
  const back = `${link.pathname}${link.hash}`;
  return `${ORIGIN}/__preview/as/${GUEST.login}?return=${encodeURIComponent(back)}`;
}

async function createPreviewHandoffs(studio: Awaited<ReturnType<typeof startMachine>>) {
  const { engine } = studio;
  const [claimed, waiting] = Object.values(engine.state.tasks).filter(
    (task) =>
      task.handle && task.repoId && !task.share && !task.backlog && !task.watchHome && !isTaskSettled(task)
  );
  if (!(claimed && waiting)) return [];
  await engine.dispatch({ type: 'task.hand_off', taskId: claimed.id });
  await engine.dispatch({ type: 'handoff.claim', taskId: claimed.id, guest: GUEST });
  await engine.dispatch(
    { type: 'task.message', taskId: claimed.id, text: 'I have this from here. Keep going with the plan.' },
    { guest: { taskId: claimed.id, login: GUEST.login } }
  );
  await engine.dispatch({ type: 'task.hand_off', taskId: waiting.id });
  const claim = await waitForHandoffLink(engine, waiting.id);
  const at = (task: Task) => `http://${HOST}:${studio.machine.port}/tasks/${task.handle}`;
  return [
    [
      `${claimed.handle}, handed off to @${GUEST.login} (Share task shows them, Activity their message)`,
      at(claimed),
    ],
    [`${waiting.handle}, with a hand-off link no one opened yet (Share task)`, at(waiting)],
    [
      `${waiting.handle}'s hand-off link, signed in as @${GUEST.login} (open it in a private window)`,
      resolveClaimAs(claim),
    ],
    [`Sign in as @${USER.login} again`, `${ORIGIN}/__preview/as/${USER.login}`],
  ];
}

async function createServicePreview(
  studio: Awaited<ReturnType<typeof startMachine>>
): Promise<{ preview: ServicePreview; demo: DemoService } | null> {
  const { engine, terminals } = studio;
  const task = Object.values(engine.state.tasks).find(
    (entry) => entry.repoId && entry.projectId && entry.worktreePath && !isTaskSettled(entry)
  );
  const repo = task?.repoId ? engine.state.repos[task.repoId] : undefined;
  if (!(task?.projectId && repo)) return null;
  const service = terminals.addService(task.projectId, {
    name: 'web',
    cwd: repo.path,
    command: DEMO_COMMAND,
    env: {},
    previewUrl: 'http://localhost:{port}/',
    portVariable: 'PORT',
  });
  const demo: DemoService = { terminals, serviceId: service.id, taskId: task.id };
  startDemoService(demo);
  await engine.dispatch({ type: 'preview.share', taskId: task.id, serviceId: service.id, limit: 'none' });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const preview = engine.state.tasks[task.id]?.previews?.find((entry) => entry.serviceId === service.id);
    if (preview?.url)
      return {
        preview: { url: preview.url, handle: task.handle ?? task.id, port: studio.machine.port },
        demo,
      };
    if (preview?.failure) throw new Error(`Sharing the demo preview failed: ${preview.failure}`);
    await Bun.sleep(100);
  }
  throw new Error('Sharing the demo preview did not finish.');
}

function startDemoService(demo: DemoService) {
  demo.terminals.startService(demo.serviceId, { cwd: ROOT, place: 'worktree', taskId: demo.taskId });
}

function createPreviewWorld(machines: Machine[]): CloudWorld {
  return {
    store: {
      selectInstance: (id: string) =>
        Promise.resolve(
          machines.some((machine) => machine.id === id) ? { online: 1, last_seen_at: Date.now() } : null
        ),
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
  const key = readPreviewCookie(request);
  if (!(address && machine && key)) return new Response('Not shared', { status: 404 });
  const path = `${resolvePreviewTunnelPath(address.previewId, url.pathname)}${url.search}`;
  const data: TunnelData = {
    machine,
    path,
    upstream: null,
    pending: [],
    headers: { [PREVIEW_KEY_HEADER]: key },
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

const DEMO_TOGGLE = /^\/__preview\/demo\/(start|stop)$/;

async function toggleDemoService(demo: DemoService | null, url: URL) {
  if (demo && url.pathname.endsWith('/start')) startDemoService(demo);
  if (demo && url.pathname.endsWith('/stop')) await demo.terminals.stopService(demo.serviceId, demo.taskId);
  return new Response(`The web service ${url.pathname.endsWith('/stop') ? 'stopped' : 'started'}.`);
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

function readPreviewCookie(request: Request) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === PREVIEW_COOKIE) return rest.join('=');
  }
  return null;
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

function listPreviewLinks(machines: Machine[], shares: PreviewShare[], preview: ServicePreview | null) {
  return [
    ['The merged dashboard (always signed in)', `${ORIGIN}${REMOTE_PATHS.app}`],
    ...(preview
      ? [
          [
            `${preview.handle} on Studio's own app, no sign-in: its Services, Share preview and Stop sharing`,
            `http://${HOST}:${preview.port}/tasks/${preview.handle}`,
          ],
          [
            `The shared preview of ${preview.handle}'s web service, with live updates over a WebSocket`,
            preview.url,
          ],
          ['Stop the web service (the preview then says it is not running)', `${ORIGIN}/__preview/demo/stop`],
          ['Start the web service again', `${ORIGIN}/__preview/demo/start`],
          ['A preview link that no longer works', `http://${'a'.repeat(32)}.localhost:${PORT}/`],
        ]
      : []),
    [
      'Sign in as the iPhone app does (answers shinsa://signed-in?code=preview, which the token path takes)',
      `${ORIGIN}${REMOTE_PATHS.signIn}?client=${REMOTE_NATIVE_CLIENT}&redirect=shinsa://signed-in`,
    ],
    ...machines.map((machine) => [
      `Add this device to ${machine.name}`,
      `${ORIGIN}/__preview/enroll/${machine.id}`,
    ]),
    ...machines.map((machine) => [
      `Add this device to ${machine.name} as the machine it sits on`,
      `${ORIGIN}/__preview/enroll/${machine.id}?on=machine`,
    ]),
    ['All tasks, each with its machine', `${ORIGIN}/tasks`],
    ['Settings, with Machines', `${ORIGIN}/settings`],
    ['Approving a pairing (code K7PQ)', `${ORIGIN}${REMOTE_PATHS.pairPage}?code=K7PQ`],
    ...shares.flatMap((share) => [
      [`${share.label} (a live link, no sign-in)`, share.url],
      [`The same task, ${share.handle}, on Studio`, `http://${HOST}:${share.port}/tasks/${share.handle}`],
    ]),
    ['A share link that no longer works', serializeShareUrl(ORIGIN, createShareLink('studio'))],
    ...machines.map((machine) => [
      `${machine.name}'s own app: Settings`,
      `http://${HOST}:${machine.port}/settings`,
    ]),
  ];
}

async function createConnect(machine: Machine, user: RemoteUser = USER): Promise<ConnectResponse> {
  const expiresAt = Date.now() + CONNECT_TOKEN_TTL_MS;
  const token = await createConnectToken(machine.connectKey, {
    instanceId: machine.id,
    userId: user.id,
    expiresAt,
  });
  return {
    url: `ws://${HOST}:${PORT}/__preview/tunnel/${machine.id}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`,
    expiresAt,
  };
}

async function respondConnect(machine: Machine, user: RemoteUser) {
  return Response.json(await createConnect(machine, user));
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

const HANDOFFS = new Map<string, string>();

function respondInviteCreate(request: Request, machines: Machine[], tokens: Map<string, string>) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer preview-/, '');
  const machine = machines.find((entry) => entry.id === bearer);
  if (!machine) return Response.json({ error: { code: 'revoked', message: 'Not paired.' } }, { status: 401 });
  const token = crypto.randomUUID().replaceAll('-', '');
  tokens.set(token, machine.id);
  const answer: InviteCreateResponse = { token };
  return Response.json(answer);
}

async function respondInviteAccept(
  request: Request,
  machines: Machine[],
  user: RemoteUser,
  tokens: Map<string, string>,
  code: string
) {
  const { token } = (await request.json()) as { token?: string };
  const machine = machines.find((entry) => entry.id === tokens.get(token ?? ''));
  if (!machine)
    return Response.json(
      { error: { code, message: 'This link was turned off. Ask the machine’s owner for a new one.' } },
      { status: 404 }
    );
  const answer: InviteAcceptResponse = {
    instanceId: machine.id,
    name: machine.name,
    owner: USER,
    user,
    connect: await createConnect(machine, user),
  };
  return Response.json(answer);
}

async function respondGuestChange(request: Request, add: boolean) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer preview-/, '');
  const { userId } = (await request.json()) as { userId?: string };
  if (userId !== GUEST.id) return Response.json({ ok: true });
  if (!add) {
    GUEST_MACHINES.delete(bearer);
    return Response.json({ ok: true });
  }
  GUEST_MACHINES.add(bearer);
  const member: RemoteMember = { user: GUEST, addedAt: Date.now() };
  return Response.json(member);
}

async function respondRequester(request: Request) {
  const { userId } = (await request.json()) as { userId?: string };
  return Response.json(userId === GUEST.id ? GUEST : USER);
}

function readPreviewUser(request: Request) {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie.includes(`${AS_COOKIE}=${GUEST.login}`) ? GUEST : USER;
}

function respondSignInAs(login: string, url: URL) {
  const user = login === GUEST.login ? GUEST : USER;
  const back = url.searchParams.get('return') ?? '';
  const location = back.startsWith('/') && !back.startsWith('//') ? back : REMOTE_PATHS.app;
  return new Response(null, {
    status: 302,
    headers: { location, 'set-cookie': `${AS_COOKIE}=${user.login}; Path=/; SameSite=Lax` },
  });
}

async function respondDashboard(request: Request, url: URL, machines: Machine[]) {
  const { pathname } = url;
  const user = readPreviewUser(request);
  if (pathname === REMOTE_PATHS.session) return Response.json({ user });
  if (pathname === REMOTE_PATHS.signIn && url.searchParams.get('client') === REMOTE_NATIVE_CLIENT)
    return respondNativeSignIn(url);
  if (pathname === REMOTE_PATHS.signInToken && request.method === 'POST') {
    const answer: NativeSignInTokenResponse = { token: 'preview', user: USER };
    return Response.json(answer);
  }
  if (pathname === REMOTE_PATHS.signIn)
    return Response.redirect(`${ORIGIN}${url.searchParams.get('return') ?? REMOTE_PATHS.app}`, 302);
  if (pathname === REMOTE_PATHS.signOut) return Response.json({});
  if (pathname === REMOTE_PATHS.instances) return Response.json(await listInstances(machines, user));
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
  if (machine && pathname.endsWith('/connect') && request.method === 'POST')
    return respondConnect(machine, user);
  if (machine && (pathname.endsWith('/remove') || pathname.endsWith('/leave'))) return Response.json({});
  return respondAccess(request, pathname, machines, user);
}

function respondAccess(request: Request, pathname: string, machines: Machine[], user: RemoteUser) {
  if (pathname === REMOTE_PATHS.machineInvites) return respondInviteCreate(request, machines, INVITES);
  if (pathname === REMOTE_PATHS.inviteAccept)
    return respondInviteAccept(request, machines, user, INVITES, 'invite_invalid');
  if (pathname === REMOTE_PATHS.machineHandoffs) return respondInviteCreate(request, machines, HANDOFFS);
  if (pathname === REMOTE_PATHS.handoffAccept)
    return respondInviteAccept(request, machines, user, HANDOFFS, 'handoff_invalid');
  if (pathname === REMOTE_PATHS.machineGuestAdd) return respondGuestChange(request, true);
  if (pathname === REMOTE_PATHS.machineGuestRemove) return respondGuestChange(request, false);
  if (pathname === REMOTE_PATHS.machineRequester) return respondRequester(request);
  if (
    pathname === REMOTE_PATHS.machineInviteRemove ||
    pathname === REMOTE_PATHS.machineMemberRemove ||
    pathname === REMOTE_PATHS.machineHandoffRemove
  )
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
  rmSync(PREVIEW_DIR, { recursive: true, force: true });
  const studioData = seedStudio();
  const laptopData = prepareLaptop();
  const studio = await startMachine('studio', 'Studio', studioData);
  const laptop = await startMachine('laptop', 'Laptop', laptopData);
  await seedLaptop(laptop.engine, laptopData);
  const machines = [studio.machine, laptop.machine];
  const shares = await createPreviewShares(studio);
  const shared = await createServicePreview(studio);
  const preview = shared?.preview ?? null;
  const demo = shared?.demo ?? null;
  const world = createPreviewWorld(machines);
  Bun.serve<TunnelData>({
    port: PORT,
    hostname: HOST,
    fetch(request, server) {
      const url = new URL(request.url);
      if (isPreviewHost(url.host, PREVIEW_ZONE))
        return respondPreviewHost(request, url, machines, world, server);
      if (DEMO_TOGGLE.test(url.pathname)) return toggleDemoService(demo, url);
      const share = SHARE_CONNECT.exec(url.pathname);
      if (share && request.method === 'POST') return respondShareConnect(share, machines);
      const as = /^\/__preview\/as\/([a-z]+)$/.exec(url.pathname);
      if (as) return respondSignInAs(as[1] ?? '', url);
      const enroll = /^\/__preview\/enroll\/([a-z]+)$/.exec(url.pathname);
      const enrolling = machines.find((entry) => entry.id === enroll?.[1]);
      if (enrolling) return respondEnroll(enrolling, url);
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
  const handoffs = await createPreviewHandoffs(studio);
  for (const [label, url] of [...listPreviewLinks(machines, shares, preview), ...handoffs])
    console.info(`${label}: ${url}`);
}

await main();
