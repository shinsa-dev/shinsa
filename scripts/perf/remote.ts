import { Database } from 'bun:sqlite';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import {
  Clock,
  Console,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  type PlatformError,
  Stream,
} from 'effect';
import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { REMOTE_FILE } from '../../apps/engine/src/remote/index.ts';
import { resolveStateVersion } from '../../apps/engine/src/store/index.ts';
import { Engine } from '../../apps/engine/test/helpers/engine.ts';
import { openEventLog } from '../../apps/engine/test/helpers/event-log.ts';
import { createTestEvidence } from '../../apps/engine/test/helpers/evidence.ts';
import { openRemoteChannel } from '../../apps/web/src/lib/remote/channel.ts';
import type { RemoteChannel } from '../../apps/web/src/lib/remote/remote-channel/schema.ts';
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
import { startRemoteMachine } from '../kit/remote.ts';
import { startIdleServer } from '../kit/server.ts';
import { createTranscripts } from '../kit/transcripts.ts';
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
import {
  API_PATHS,
  type BenchMachine,
  DNS_POLL,
  DnsAnswer,
  HEALTH_POLL,
  INSTANCE,
  MAX_BODY_BYTES,
  PARALLEL,
  PARALLEL_ROUNDS,
  REGISTERED_LINE,
  RemoteBenchFailed,
  TUNNEL_HOST,
  TUNNEL_TIMEOUT,
  TunnelNotReady,
  USER_ID,
} from './remote/schema.ts';
import { writeReport } from './report/write.ts';
import { elapsedSince } from './timing.ts';

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

const program = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const clock = yield* Clock.Clock;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const requests = Number(args.requests);
  const connects = Number(args.connects);

  const attempt = <A>(run: () => A) =>
    Effect.try({ try: run, catch: (error) => new RemoteBenchFailed({ message: String(error) }) });

  const toFailed = (error: PlatformError.PlatformError) => new RemoteBenchFailed({ message: error.message });

  const attemptPromise = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: (error) => new RemoteBenchFailed({ message: String(error) }) });

  const copyLog = Effect.fn('RemoteBench.copyLog')(function* (dataDir: string) {
    const onboardedAt = yield* Clock.currentTimeMillis;
    yield* fs.remove(dataDir, { recursive: true, force: true }).pipe(Effect.mapError(toFailed));
    yield* fs.makeDirectory(dataDir, { recursive: true }).pipe(Effect.mapError(toFailed));
    yield* attempt(() => {
      const database = new Database(join(args.source, 'shinsa.sqlite'), { readonly: true });
      database.run(`VACUUM INTO '${join(dataDir, 'shinsa.sqlite').replaceAll("'", "''")}'`);
      database.close();
    });
    yield* fs
      .writeFileString(
        join(dataDir, 'config.json'),
        `${JSON.stringify({ version: 1, roots: [], onboardedAt }, null, 2)}\n`
      )
      .pipe(Effect.mapError(toFailed));
  });

  const writeRemoteFile = Effect.fn('RemoteBench.writeRemoteFile')(function* (
    dataDir: string,
    connectKey: string
  ) {
    const device = yield* attemptPromise(
      () => crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
    );
    const publicKey = yield* serializePublicKey(device.publicKey);
    const enrolledAt = yield* Clock.currentTimeMillis;
    const owner = { id: USER_ID, login: 'bench', name: 'Bench', avatarUrl: null };
    yield* fs
      .writeFileString(
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
          devices: [{ publicKey, name: 'Bench', enrolledAt, lastSeenAt: null, userId: USER_ID }],
          access: { owner, members: [] },
        })
      )
      .pipe(Effect.mapError(toFailed));
    return device;
  });

  const startEngine = Effect.fn('RemoteBench.startEngine')(function* (dataDir: string) {
    const config = yield* Effect.provide(
      EngineConfig,
      EngineConfig.layer(
        { ...Bun.env, SHINSA_DATA_DIR: dataDir, SHINSA_PORT: '0', SHINSA_INSPECT: '1' },
        null
      )
    );
    yield* Effect.forEach([config.worktreesDir, config.evidenceDir, config.transcriptsDir], (dir) =>
      fs.makeDirectory(dir, { recursive: true })
    ).pipe(Effect.mapError(toFailed));
    const stateVersion = yield* resolveStateVersion();
    const [bootFor, engine] = yield* Effect.timed(
      Effect.acquireRelease(
        Effect.sync(() => new Engine(openEventLog(config.databasePath), { stateVersion })),
        (running) => Effect.sync(() => running.stop())
      )
    );
    const remote = yield* attemptPromise(() =>
      startRemoteMachine({
        engine,
        config,
        refusal: 'The bench runs its own tunnel.',
        localUrl: 'http://127.0.0.1',
        version: 'bench',
        maxBodyBytes: MAX_BODY_BYTES,
        machineName: 'Bench',
      })
    );
    const server = yield* Effect.acquireRelease(
      startIdleServer({
        engine,
        config,
        transcripts: createTranscripts(config.transcriptsDir),
        evidence: createTestEvidence(config.evidenceDir),
        ...remote.services,
      }).pipe(Effect.catchDefect((error) => Effect.fail(new RemoteBenchFailed({ message: String(error) })))),
      (running) => Effect.promise(running.stop)
    );
    return {
      port: server.server.port ?? 0,
      bootMs: Duration.toMillis(bootFor),
      resolveMachineKey: attemptPromise(remote.resolveMachineKey),
    };
  });

  const timeCloudConnect = Effect.fn('RemoteBench.timeCloudConnect')(function* () {
    const samples: number[] = [];
    for (let index = 0; index < requests; index += 1) {
      const started = yield* Clock.currentTimeNanos;
      const response = yield* http.post(`${REMOTE_APP_ORIGIN}${resolveInstanceConnectPath(INSTANCE)}`, {
        body: HttpBody.text('{}', 'application/json'),
      });
      yield* response.arrayBuffer;
      samples.push(yield* elapsedSince(started));
    }
    return summarizeCloud(samples);
  });

  const awaitReachable = Effect.fn('RemoteBench.awaitReachable')(function* (url: string, started: bigint) {
    const { hostname } = new URL(url);
    const remaining = Effect.map(elapsedSince(started), (spent) =>
      Duration.subtract(TUNNEL_TIMEOUT, Duration.millis(spent))
    );
    const published = http
      .get(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
        headers: { accept: 'application/dns-json' },
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(DnsAnswer)),
        Effect.map((answer) => (answer.Answer?.length ?? 0) > 0)
      );
    yield* published.pipe(
      Effect.repeat({ schedule: DNS_POLL, until: (found) => found }),
      Effect.timeoutOrElse({
        duration: yield* remaining,
        orElse: () => Effect.fail(new TunnelNotReady({ message: `${hostname} was never published.` })),
      })
    );
    const healthy = HttpClient.filterStatusOk(http)
      .get(`${url}/health`)
      .pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false)
      );
    yield* healthy.pipe(
      Effect.repeat({ schedule: HEALTH_POLL, until: (ok) => ok }),
      Effect.timeoutOrElse({
        duration: yield* remaining,
        orElse: () => Effect.fail(new TunnelNotReady({ message: `${url} never answered /health.` })),
      })
    );
  });

  const startTunnel = Effect.fn('RemoteBench.startTunnel')(function* (port: number, protocol: string) {
    const started = yield* Clock.currentTimeNanos;
    const tunnel = yield* spawner
      .spawn(
        ChildProcess.make(
          args.cloudflared,
          ['tunnel', '--no-autoupdate', '--protocol', protocol, '--url', `http://127.0.0.1:${port}`],
          { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' }
        )
      )
      .pipe(Effect.mapError((error) => new RemoteBenchFailed({ message: error.message })));
    const address = yield* Deferred.make<string>();
    const registered = yield* Deferred.make<number>();
    const readLine = Effect.fn('RemoteBench.readTunnelLine')(function* (line: string) {
      const found = parseQuickTunnelUrl(line);
      if (found) yield* Deferred.succeed(address, found);
      if (line.includes(REGISTERED_LINE)) yield* Deferred.succeed(registered, yield* elapsedSince(started));
    });
    yield* tunnel.stderr.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach(readLine),
      Effect.ignore,
      Effect.forkScoped
    );
    const url = yield* Deferred.await(address).pipe(
      Effect.timeoutOrElse({
        duration: TUNNEL_TIMEOUT,
        orElse: () =>
          Effect.fail(new TunnelNotReady({ message: 'cloudflared printed no quick tunnel URL.' })),
      })
    );
    const registeredMs = yield* Deferred.await(registered).pipe(
      Effect.timeoutOrElse({
        duration: TUNNEL_TIMEOUT,
        orElse: () => Effect.fail(new TunnelNotReady({ message: 'cloudflared registered no connection.' })),
      })
    );
    yield* awaitReachable(url, started);
    const start: TunnelStart = {
      label: `Tunnel (${protocol})`,
      registered: registeredMs,
      reachable: yield* elapsedSince(started),
    };
    return { url, start };
  });

  const awaitFirstState = (channel: RemoteChannel) =>
    Effect.callback<number>((resume) => {
      const release = channel.subscribeSocket((data) => {
        if (!data.startsWith('{"type":"state"')) return;
        release();
        resume(Effect.succeed(Buffer.byteLength(data)));
      });
      return Effect.sync(release);
    });

  const connectOnce = Effect.fn('RemoteBench.connectOnce')(function* (
    base: string,
    local: boolean,
    machine: BenchMachine
  ) {
    const now = yield* Clock.currentTimeMillis;
    const nonce = serializeBase64Url(yield* Effect.sync(() => crypto.getRandomValues(new Uint8Array(16))));
    const token = yield* createConnectToken(machine.connectKey, {
      instanceId: INSTANCE,
      userId: USER_ID,
      channel: 'remote',
      nonce,
      expiresAt: now + CONNECT_TOKEN_TTL_MS,
    });
    const url = `${base}${REMOTE_CHANNEL_PATH}?${REMOTE_CONNECT_PARAM}=${encodeURIComponent(token)}`;
    let largestFrame = 0;
    const opened = yield* Deferred.make<bigint>();
    const openSocket = (socketUrl: string) => {
      const headers: Record<string, string> = { origin: REMOTE_APP_ORIGIN };
      if (local) headers['cf-connecting-ip'] = '127.0.0.1';
      const socket = new WebSocket(socketUrl, { headers } as never);
      socket.addEventListener(
        'open',
        () => Deferred.doneUnsafe(opened, Exit.succeed(clock.currentTimeNanosUnsafe())),
        { once: true }
      );
      socket.addEventListener('message', (event) => {
        if (event.data instanceof ArrayBuffer) largestFrame = Math.max(largestFrame, event.data.byteLength);
      });
      return socket;
    };
    const started = yield* Clock.currentTimeNanos;
    const channel = yield* attemptPromise(() =>
      openRemoteChannel({
        url,
        machineKey: machine.machineKey,
        device: machine.device,
        enrollSecret: null,
        openSocket,
      })
    );
    const readyAt = yield* Clock.currentTimeNanos;
    const openedAt = yield* Deferred.await(opened);
    const stateBytes = yield* awaitFirstState(channel);
    const sample: ConnectSample = {
      socketOpen: Number(openedAt - started) / 1e6,
      handshake: Number(readyAt - openedAt) / 1e6,
      firstState: yield* elapsedSince(readyAt),
      stateFrameBytes: largestFrame,
      stateBytes,
    };
    return { channel, sample };
  });

  const timeRequest = Effect.fn('RemoteBench.timeRequest')(function* (channel: RemoteChannel, path: string) {
    const started = yield* Clock.currentTimeNanos;
    const response = yield* attemptPromise(() =>
      channel.request({ method: 'GET', path, headers: [], body: null })
    );
    yield* attemptPromise(() => response.arrayBuffer());
    return yield* elapsedSince(started);
  });

  const measureRoute = Effect.fn('RemoteBench.measureRoute')(function* (
    label: string,
    base: string,
    local: boolean,
    machine: BenchMachine
  ) {
    const httpBase = base.replace(/^ws/, 'http');
    const health: number[] = [];
    for (let index = 0; index < requests; index += 1) {
      const started = yield* Clock.currentTimeNanos;
      const response = yield* http.get(`${httpBase}/health`, {
        headers: local ? { 'cf-connecting-ip': '127.0.0.1' } : {},
      });
      yield* response.arrayBuffer;
      health.push(yield* elapsedSince(started));
    }
    const connectSamples: ConnectSample[] = [];
    let channel: RemoteChannel | null = null;
    for (let index = 0; index < connects; index += 1) {
      channel?.close();
      const opened = yield* connectOnce(base, local, machine);
      channel = opened.channel;
      connectSamples.push(opened.sample);
      yield* Console.error(
        `${label}: connect ${index + 1} took ${Math.round(opened.sample.firstState)} ms to state`
      );
    }
    if (!channel) return yield* new RemoteBenchFailed({ message: 'No connect ran.' });
    const open = channel;
    const timed: Record<string, number[]> = {};
    for (const path of API_PATHS)
      timed[path] = yield* Effect.forEach(Array.from({ length: requests }), () => timeRequest(open, path));
    const parallel: number[] = [];
    for (let index = 0; index < PARALLEL_ROUNDS; index += 1) {
      const [took] = yield* Effect.timed(
        Effect.forEach(Array.from({ length: PARALLEL }), () => timeRequest(open, '/api/health'), {
          concurrency: PARALLEL,
        })
      );
      parallel.push(Duration.toMillis(took));
    }
    open.close();
    const samples: RouteSamples = { label, health, connects: connectSamples, requests: timed, parallel };
    return samples;
  });

  const dataDir = join(resolve(args.scratch), 'data');
  yield* Console.error(`Copying ${args.source} to ${dataDir}…`);
  yield* copyLog(dataDir);
  const connectKey = serializeBase64Url(yield* Effect.sync(() => crypto.getRandomValues(new Uint8Array(32))));
  const device = yield* writeRemoteFile(dataDir, connectKey);
  const machine = yield* startEngine(dataDir);
  const target: BenchMachine = { connectKey, device, machineKey: yield* machine.resolveMachineKey };
  yield* Console.error(`Engine up on :${machine.port} after ${Math.round(machine.bootMs)} ms.`);
  const cloud: RemoteReport['cloud'] = args.offline ? null : yield* timeCloudConnect();
  const routes = [yield* measureRoute('Loopback', `ws://127.0.0.1:${machine.port}`, true, target)];
  const tunnels: TunnelStart[] = [];
  const protocols = args.offline ? [] : args.protocols.split(',').filter(Boolean);
  for (const protocol of protocols) {
    const tunnelRoute = yield* Effect.scoped(
      Effect.gen(function* () {
        const tunnel = yield* startTunnel(machine.port, protocol);
        tunnels.push(tunnel.start);
        return yield* measureRoute(tunnel.start.label, tunnel.url.replace(/^https/, 'wss'), false, target);
      })
    );
    routes.push(tunnelRoute);
  }
  const report: RemoteReport & { bootMs: number } = {
    cloud,
    tunnels,
    routes: routes.map(summarizeRoute),
    bootMs: machine.bootMs,
  };
  if (args.json) yield* writeReport(args.json, `${JSON.stringify(report, null, 2)}\n`);
  yield* Console.log(serializeRemoteTable(report));
});

program.pipe(
  Effect.scoped,
  Effect.provide(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer)),
  BunRuntime.runMain
);
