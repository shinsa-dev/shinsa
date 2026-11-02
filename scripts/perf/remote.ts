import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Transcripts } from '../../apps/engine/src/agents/index.ts';
import { ConfigStore, resolveConfig } from '../../apps/engine/src/config/index.ts';
import { startServer } from '../../apps/engine/src/http/index.ts';
import { Onboarding } from '../../apps/engine/src/onboarding/index.ts';
import { REMOTE_FILE, Remote } from '../../apps/engine/src/remote/index.ts';
import { Roots } from '../../apps/engine/src/repos/index.ts';
import { Engine } from '../../apps/engine/src/runtime/index.ts';
import { EventLog, EvidenceStore, resolveStateVersion } from '../../apps/engine/src/store/index.ts';
import { openRemoteChannel, type RemoteChannel } from '../../apps/web/src/lib/remote/channel.ts';
import {
  CONNECT_TOKEN_TTL_MS,
  createConnectToken,
  REMOTE_APP_ORIGIN,
  REMOTE_CHANNEL_PATH,
  REMOTE_CONNECT_PARAM,
  REMOTE_KEY_ALGORITHM,
  resolveInstanceConnectPath,
  serializeBase64Url,
  serializePublicKey,
} from '../../packages/core/src/index.ts';
import {
  type ConnectSample,
  parseQuickTunnelUrl,
  type RemoteReport,
  type RouteSamples,
  serializeRemoteTable,
  summarizeCloud,
  summarizeRoute,
  type TunnelStart,
} from './remote-stats.ts';

const INSTANCE = 'bench';
const USER_ID = '1';
const TUNNEL_HOST = 'bench.tunnel.invalid';
const API_PATHS = ['/api/health', '/api/queue'];
const PARALLEL = 10;
const TUNNEL_TIMEOUT_MS = 180_000;

const { values: args } = parseArgs({
  options: {
    source: { type: 'string', default: join(homedir(), '.config/shinsa/data') },
    scratch: { type: 'string', default: '/tmp/shinsa-perf-remote' },
    connects: { type: 'string', default: '5' },
    requests: { type: 'string', default: '20' },
    protocols: { type: 'string', default: 'quic,http2' },
    cloudflared: { type: 'string', default: 'cloudflared' },
    json: { type: 'string' },
    offline: { type: 'boolean', default: false },
  },
});

function copyLog(source: string, dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const database = new Database(join(source, 'shinsa.sqlite'), { readonly: true });
  database.run(`VACUUM INTO '${join(dataDir, 'shinsa.sqlite').replaceAll("'", "''")}'`);
  database.close();
  writeFileSync(
    join(dataDir, 'config.json'),
    `${JSON.stringify({ version: 1, roots: [], onboardedAt: Date.now() }, null, 2)}\n`
  );
}

async function writeRemoteFile(dataDir: string, connectKey: string) {
  const device = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const owner = { id: USER_ID, login: 'bench', name: 'Bench', avatarUrl: null };
  writeFileSync(
    join(dataDir, REMOTE_FILE),
    JSON.stringify({
      version: 1,
      credentials: {
        instanceId: INSTANCE,
        machineToken: 'bench',
        tunnelToken: 'bench',
        tunnelHost: TUNNEL_HOST,
        connectKey,
      },
      enabled: true,
      owner: owner.login,
      devices: [
        {
          publicKey: await serializePublicKey(device.publicKey),
          name: 'Bench',
          enrolledAt: Date.now(),
          lastSeenAt: null,
          userId: USER_ID,
        },
      ],
      access: { owner, members: [] },
    })
  );
  return device;
}

function startEngine(dataDir: string) {
  const config = resolveConfig({
    ...Bun.env,
    SHINSA_DATA_DIR: dataDir,
    SHINSA_PORT: '0',
    SHINSA_INSPECT: '1',
  });
  for (const dir of [config.worktreesDir, config.evidenceDir, config.transcriptsDir])
    mkdirSync(dir, { recursive: true });
  const started = performance.now();
  const engine = new Engine(new EventLog(config.databasePath), { stateVersion: resolveStateVersion() });
  const bootMs = performance.now() - started;
  const store = new ConfigStore(config.configPath);
  const roots = new Roots(config.roots, store, config.userHome, () =>
    Promise.resolve({ candidates: [], truncated: false })
  );
  const remote = new Remote({
    path: join(dataDir, REMOTE_FILE),
    connect: () => Promise.reject(new Error('The bench runs its own tunnel.')),
    localUrl: () => 'http://127.0.0.1',
    version: 'bench',
    maxBodyBytes: 32 * 1024 * 1024,
    machineName: 'Bench',
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
  return { engine, remote, http, port: http.server.port ?? 0, bootMs };
}

async function timeCloudConnect(calls: number) {
  const samples: number[] = [];
  for (let index = 0; index < calls; index += 1) {
    const started = performance.now();
    const response = await fetch(`${REMOTE_APP_ORIGIN}${resolveInstanceConnectPath(INSTANCE)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    await response.arrayBuffer();
    samples.push(performance.now() - started);
  }
  return summarizeCloud(samples);
}

interface Tunnel {
  url: string;
  start: TunnelStart;
  stop: () => void;
}

async function readTunnelLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of stream) {
    buffered += decoder.decode(chunk, { stream: true });
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  }
}

async function isHealthy(url: string) {
  try {
    const response = await fetch(`${url}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function isPublished(hostname: string) {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
    headers: { accept: 'application/dns-json' },
  });
  const answer = (await response.json()) as { Answer?: unknown[] };
  return (answer.Answer?.length ?? 0) > 0;
}

async function awaitReachable(url: string, deadline: number) {
  const { hostname } = new URL(url);
  while (!(await isPublished(hostname))) {
    if (performance.now() > deadline) throw new Error(`${hostname} was never published.`);
    await Bun.sleep(250);
  }
  while (!(await isHealthy(url))) {
    if (performance.now() > deadline) throw new Error(`${url} never answered /health.`);
    await Bun.sleep(1000);
  }
}

async function startTunnel(port: number, protocol: string): Promise<Tunnel> {
  const started = performance.now();
  const child = Bun.spawn(
    [
      args.cloudflared,
      'tunnel',
      '--no-autoupdate',
      '--protocol',
      protocol,
      '--url',
      `http://127.0.0.1:${port}`,
    ],
    { stdout: 'ignore', stderr: 'pipe' }
  );
  const url = Promise.withResolvers<string>();
  const registered = Promise.withResolvers<number>();
  void readTunnelLines(child.stderr, (line) => {
    const found = parseQuickTunnelUrl(line);
    if (found) url.resolve(found);
    if (line.includes('Registered tunnel connection')) registered.resolve(performance.now() - started);
  });
  const timeout = setTimeout(() => {
    url.reject(new Error('cloudflared printed no quick tunnel URL.'));
    registered.reject(new Error('cloudflared registered no connection.'));
  }, TUNNEL_TIMEOUT_MS);
  const address = await url.promise;
  const registeredMs = await registered.promise;
  clearTimeout(timeout);
  await awaitReachable(address, started + TUNNEL_TIMEOUT_MS);
  return {
    url: address,
    start: {
      label: `Tunnel (${protocol})`,
      registered: registeredMs,
      reachable: performance.now() - started,
    },
    stop: () => child.kill(),
  };
}

function createSocketOpener(local: boolean, onOpen: () => void, onFrame: (bytes: number) => void) {
  return (url: string) => {
    const headers: Record<string, string> = { origin: REMOTE_APP_ORIGIN };
    if (local) headers['cf-connecting-ip'] = '127.0.0.1';
    const socket = new WebSocket(url, { headers } as never);
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) onFrame(event.data.byteLength);
    });
    return socket;
  };
}

function awaitFirstState(channel: RemoteChannel) {
  return new Promise<number>((resolveState) => {
    const release = channel.subscribeSocket((data) => {
      if (!data.startsWith('{"type":"state"')) return;
      release();
      resolveState(Buffer.byteLength(data));
    });
  });
}

interface BenchMachine {
  connectKey: string;
  machineKey: string;
  device: CryptoKeyPair;
}

async function connectOnce(base: string, local: boolean, machine: BenchMachine) {
  const token = await createConnectToken(machine.connectKey, {
    instanceId: INSTANCE,
    userId: USER_ID,
    expiresAt: Date.now() + CONNECT_TOKEN_TTL_MS,
  });
  const url = `${base}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
  let largestFrame = 0;
  let openedAt = 0;
  const started = performance.now();
  const opener = createSocketOpener(
    local,
    () => {
      openedAt = performance.now();
    },
    (bytes) => {
      largestFrame = Math.max(largestFrame, bytes);
    }
  );
  const channel = await openRemoteChannel({
    url,
    machineKey: machine.machineKey,
    device: machine.device,
    enrollSecret: null,
    openSocket: opener,
  });
  const readyAt = performance.now();
  const stateBytes = await awaitFirstState(channel);
  const sample: ConnectSample = {
    socketOpen: openedAt - started,
    handshake: readyAt - openedAt,
    firstState: performance.now() - readyAt,
    stateFrameBytes: largestFrame,
    stateBytes,
  };
  return { channel, sample };
}

async function timeRequest(channel: RemoteChannel, path: string) {
  const started = performance.now();
  const response = await channel.request({ method: 'GET', path, headers: [], body: null });
  await response.arrayBuffer();
  return performance.now() - started;
}

async function measureRoute(
  label: string,
  base: string,
  local: boolean,
  machine: BenchMachine
): Promise<RouteSamples> {
  const httpBase = base.replace(/^ws/, 'http');
  const health: number[] = [];
  for (let index = 0; index < Number(args.requests); index += 1) {
    const started = performance.now();
    const response = await fetch(`${httpBase}/health`, {
      headers: local ? { 'cf-connecting-ip': '127.0.0.1' } : {},
    });
    await response.arrayBuffer();
    health.push(performance.now() - started);
  }
  const connects: ConnectSample[] = [];
  let channel: RemoteChannel | null = null;
  for (let index = 0; index < Number(args.connects); index += 1) {
    channel?.close();
    const opened = await connectOnce(base, local, machine);
    channel = opened.channel;
    connects.push(opened.sample);
    console.error(`${label}: connect ${index + 1} took ${Math.round(opened.sample.firstState)} ms to state`);
  }
  if (!channel) throw new Error('No connect ran.');
  const requests: Record<string, number[]> = {};
  for (const path of API_PATHS) {
    const values: number[] = [];
    for (let index = 0; index < Number(args.requests); index += 1)
      values.push(await timeRequest(channel, path));
    requests[path] = values;
  }
  const parallel: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const open = channel;
    await Promise.all(Array.from({ length: PARALLEL }, () => timeRequest(open, '/api/health')));
    parallel.push(performance.now() - started);
  }
  channel.close();
  return { label, health, connects, requests, parallel };
}

async function runRemoteBench(): Promise<RemoteReport & { bootMs: number }> {
  const dataDir = join(resolve(args.scratch), 'data');
  console.error(`Copying ${args.source} to ${dataDir}…`);
  copyLog(args.source, dataDir);
  const connectKey = serializeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const device = await writeRemoteFile(dataDir, connectKey);
  const machine = startEngine(dataDir);
  const target: BenchMachine = {
    connectKey,
    device,
    machineKey: (await machine.remote.store.resolveMachineKey()).publicKey,
  };
  console.error(`Engine up on :${machine.port} after ${Math.round(machine.bootMs)} ms.`);
  let cloud: RemoteReport['cloud'] = null;
  if (!args.offline) cloud = await timeCloudConnect(Number(args.requests));
  const routes = [await measureRoute('Loopback', `ws://127.0.0.1:${machine.port}`, true, target)];
  const tunnels: TunnelStart[] = [];
  const protocols = args.offline ? [] : args.protocols.split(',').filter(Boolean);
  for (const protocol of protocols) {
    const tunnel = await startTunnel(machine.port, protocol);
    tunnels.push(tunnel.start);
    try {
      routes.push(await measureRoute(tunnel.start.label, tunnel.url.replace(/^https/, 'wss'), false, target));
    } finally {
      tunnel.stop();
    }
  }
  machine.http.server.stop(true);
  machine.engine.stop();
  return { cloud, tunnels, routes: routes.map(summarizeRoute), bootMs: machine.bootMs };
}

if (import.meta.main) {
  const report = await runRemoteBench();
  if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 2)}\n`);
  console.log(serializeRemoteTable(report));
  process.exit(0);
}
