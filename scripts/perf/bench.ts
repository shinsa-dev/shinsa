import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Clock, Console, Context, Duration, Effect, Fiber, Layer, Schedule } from 'effect';
import { Socket } from 'effect/socket';
import { Transcripts } from '../../apps/engine/src/agents/transcripts/service.ts';
import type { ServerConfig } from '../../apps/engine/src/config/index.ts';
import { EngineConfig } from '../../apps/engine/src/config/service.ts';
import { type HubSocket, makeSocketHub, type SocketData } from '../../apps/engine/src/http/socket.ts';
import { JsonLogger } from '../../apps/engine/src/log/service.ts';
import { EngineCore } from '../../apps/engine/src/runtime/engine/service.ts';
import { resolveStateVersion } from '../../apps/engine/src/store/index.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import type { ShinsaState, TaskPriority, UserCommand } from '../../packages/core/src/index.ts';
import { measureClientApply, measurePushes } from './bench/client.ts';
import {
  CLICKS,
  CommandRejected,
  DataUnreadable,
  DEFAULT_SCRATCH,
  DEFAULT_SOURCE,
  EXTERNAL_APPENDS,
  MAX_PAYLOAD_BYTES,
  NothingToMeasure,
  PAGE_SOCKET,
  type PageConnection,
  type PageSocketModule,
  TRANSCRIPT_APPENDS,
} from './bench/schema.ts';
import { round, summarize } from './bench/stats.ts';
import { elapsedSince } from './timing.ts';

const SOURCE = Bun.argv[2] ?? DEFAULT_SOURCE;
const SCRATCH = Bun.argv[3] ?? DEFAULT_SCRATCH;

const program = Effect.gen(function* () {
  const createHubData = (): SocketData => ({
    kind: 'hub',
    transcripts: new Map(),
    surface: null,
    origin: 'local',
    guest: null,
  });

  const readData = <A>(read: () => A) =>
    Effect.try({ try: read, catch: (error) => new DataUnreadable({ message: String(error) }) });

  const openCore = Effect.fn('Bench.openCore')(function* (stateVersion: string | null) {
    const context = yield* Layer.build(
      EngineCore.layer({ stateVersion }).pipe(
        Layer.provide(StoreLayer(join(SCRATCH, 'shinsa.sqlite'))),
        Layer.orDie
      )
    );
    const core = Context.get(context, EngineCore);
    yield* Effect.addFinalizer(() => core.stop);
    return core;
  });

  const openTranscripts = Effect.fn('Bench.openTranscripts')(function* () {
    const context = yield* Layer.build(
      Transcripts.layer.pipe(
        Layer.provide(
          Layer.succeed(EngineConfig, { transcriptsDir: join(SCRATCH, 'transcripts') } as ServerConfig)
        )
      )
    );
    return Context.get(context, Transcripts);
  });

  const measureServer = Effect.fn('Bench.measureServer')(function* (
    core: EngineCore['Service'],
    transcripts: Transcripts['Service'],
    taskId: string
  ) {
    const hub = yield* makeSocketHub({ engine: core, transcripts });
    const sent: number[] = [];
    const payloads: string[] = [];
    const socket: HubSocket = {
      data: createHubData(),
      send: (payload: string) => {
        sent.push(payload.length);
        payloads.push(payload);
      },
    };
    hub.open(socket);
    const initialBytes = sent.reduce((sum, bytes) => sum + bytes, 0);
    const initial = payloads.find((payload) => payload.startsWith('{"type":"state"')) ?? '';
    sent.length = 0;
    payloads.length = 0;
    const latency: number[] = [];
    const cpuBefore = process.cpuUsage();
    for (let index = 0; index < CLICKS; index += 1) {
      const priority: TaskPriority = index % 2 === 0 ? 'high' : 'normal';
      const [took] = yield* Effect.timed(core.dispatch({ type: 'task.prioritize', taskId, priority }));
      latency.push(Duration.toMillis(took));
    }
    const cpu = process.cpuUsage(cpuBefore);
    hub.close(socket);
    return {
      clientApplyMs: measurePushes(initial, payloads),
      initialBytes,
      dispatchMs: summarize(latency),
      cpuMsPerCommand: round((cpu.user + cpu.system) / 1000 / CLICKS),
      bytesPerPush: summarize(sent),
    };
  }, Effect.scoped);

  const serveHub = Effect.fn('Bench.serveHub')(function* (
    core: EngineCore['Service'],
    transcripts: Transcripts['Service']
  ) {
    const hub = yield* makeSocketHub({ engine: core, transcripts });
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve<SocketData>({
          port: 0,
          hostname: '127.0.0.1',
          fetch(request, bunServer) {
            if (bunServer.upgrade(request, { data: createHubData() })) return undefined;
            return new Response('no', { status: 400 });
          },
          websocket: {
            open: hub.open,
            close: hub.close,
            message: hub.message,
            maxPayloadLength: MAX_PAYLOAD_BYTES,
          },
        })
      ),
      (running) => Effect.promise(() => running.stop(true))
    );
    return server.port ?? 0;
  });

  const openConnection = Effect.fn('Bench.openConnection')(function* (port: number) {
    yield* Effect.sync(() => Object.assign(globalThis, { location: new URL(`http://127.0.0.1:${port}/`) }));
    const page = yield* Effect.tryPromise({
      try: () => import(PAGE_SOCKET) as Promise<PageSocketModule>,
      catch: (error) => new DataUnreadable({ message: String(error) }),
    });
    return yield* Effect.acquireRelease(
      Effect.sync(() => {
        const connection = new page.Connection({
          transport: Layer.succeed(
            Socket.WebSocketConstructor,
            () => new WebSocket(`ws://127.0.0.1:${port}/ws`)
          ),
          surface: () => 'browser',
          schedule: (flush) => queueMicrotask(flush),
        });
        connection.start();
        return connection;
      }),
      (connection) => Effect.sync(() => connection.stop())
    );
  });

  const waitForState = (connection: PageConnection, check: (state: ShinsaState) => boolean) =>
    Effect.callback<void>((resume) => {
      const current = connection.snapshot().state;
      if (current && check(current)) {
        resume(Effect.void);
        return;
      }
      const unsubscribe = connection.subscribe(() => {
        const state = connection.snapshot().state;
        if (!state || !check(state)) return;
        unsubscribe();
        resume(Effect.void);
      });
      return Effect.sync(unsubscribe);
    });

  const sendCommand = (connection: PageConnection, command: UserCommand) =>
    Effect.tryPromise({
      try: () => connection.command(command),
      catch: (error) => new CommandRejected({ message: String(error) }),
    });

  const measureRoundTrip = Effect.fn('Bench.measureRoundTrip')(function* (
    core: EngineCore['Service'],
    transcripts: Transcripts['Service'],
    taskId: string
  ) {
    const port = yield* serveHub(core, transcripts);
    const connectStarted = yield* Clock.currentTimeNanos;
    const connection = yield* openConnection(port);
    yield* waitForState(connection, () => true);
    const firstState = yield* elapsedSince(connectStarted);
    const visible: number[] = [];
    const confirmed: number[] = [];
    for (let index = 0; index < CLICKS; index += 1) {
      const priority: TaskPriority = index % 2 === 0 ? 'normal' : 'high';
      const started = yield* Clock.currentTimeNanos;
      const shown = yield* Effect.forkChild(
        Effect.andThen(
          waitForState(connection, (state) => state.tasks[taskId]?.priority === priority),
          elapsedSince(started)
        )
      );
      yield* sendCommand(connection, { type: 'task.prioritize', taskId, priority });
      confirmed.push(yield* elapsedSince(started));
      visible.push(yield* Fiber.join(shown));
    }
    const project = Object.values((yield* core.state).projects)[0];
    if (!project) return yield* new NothingToMeasure({ message: 'No project to rename.' });
    const serverSample: number[] = [];
    for (let index = 0; index < CLICKS; index += 1) {
      const description = `Round trip ${index}`;
      const started = yield* Clock.currentTimeNanos;
      const shown = yield* Effect.forkChild(
        Effect.andThen(
          waitForState(connection, (state) => state.projects[project.id]?.description === description),
          elapsedSince(started)
        )
      );
      yield* sendCommand(connection, {
        type: 'project.write',
        project: {
          id: project.id,
          name: project.name,
          color: project.color,
          key: project.key,
          folders: project.folders,
          description,
        },
      });
      serverSample.push(yield* Fiber.join(shown));
    }
    return {
      firstStateMs: round(firstState),
      optimisticVisibleMs: summarize(visible),
      optimisticAckMs: summarize(confirmed),
      confirmedVisibleMs: summarize(serverSample),
    };
  }, Effect.scoped);

  const measureTranscripts = Effect.fn('Bench.measureTranscripts')(function* (
    transcripts: Transcripts['Service']
  ) {
    const folder = join(SCRATCH, 'transcripts');
    const files = yield* readData(() =>
      readdirSync(folder)
        .map((name) => ({ name, size: statSync(join(folder, name)).size }))
        .sort((a, b) => b.size - a.size)
    );
    const longest = files[0];
    if (!longest) return null;
    const runId = longest.name.replace(/\.jsonl$/, '');
    const [readFor, entries] = yield* Effect.timed(transcripts.listEntries(runId));
    const bytes = JSON.stringify({ type: 'transcript', runId, entries }).length;
    yield* Effect.acquireRelease(transcripts.follow(runId), (unfollow) => unfollow).pipe(Effect.asVoid);
    let received = 0;
    yield* Effect.acquireRelease(
      transcripts.subscribe(() => {
        received += 1;
      }),
      (unsubscribe) => unsubscribe
    ).pipe(Effect.asVoid);
    const append: number[] = [];
    for (let index = 0; index < TRANSCRIPT_APPENDS; index += 1) {
      const [took] = yield* Effect.timed(
        transcripts.record(runId, { type: 'agent', phase: 'interim', text: `Still reading (${index}).` })
      );
      append.push(Duration.toMillis(took));
    }
    const external: number[] = [];
    for (let index = 0; index < EXTERNAL_APPENDS; index += 1) {
      const before = received;
      const started = yield* Clock.currentTimeNanos;
      yield* readData(() =>
        appendFileSync(
          join(folder, longest.name),
          `${JSON.stringify({ v: 2, id: `external-${index}`, at: index, type: 'agent', phase: 'interim', text: 'More.' })}\n`
        )
      );
      yield* Effect.sync(() => received).pipe(
        Effect.repeat({ schedule: Schedule.spaced(Duration.millis(1)), until: (count) => count !== before })
      );
      external.push(yield* elapsedSince(started));
    }
    return {
      externalAppendMs: summarize(external),
      entries: entries.length,
      fileBytes: longest.size,
      subscribeReadMs: round(Duration.toMillis(readFor)),
      subscribeBytes: bytes,
      appendMs: summarize(append),
      received,
    };
  }, Effect.scoped);

  yield* readData(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
    mkdirSync(SCRATCH, { recursive: true });
    cpSync(SOURCE, SCRATCH, { recursive: true });
  });
  const version = resolveStateVersion();
  const cold = yield* Effect.scoped(
    Effect.gen(function* () {
      const [bootFor, core] = yield* Effect.timed(openCore(version));
      const [snapshotFor, written] = yield* Effect.timed(core.writeSnapshot);
      return { bootMs: Duration.toMillis(bootFor), snapshotMs: Duration.toMillis(snapshotFor), written };
    })
  );
  const [warmFor, core] = yield* Effect.timed(openCore(version));
  yield* Effect.sync(() => Bun.gc(true));
  const state = yield* core.state;
  const task = Object.values(state.tasks).find((candidate) => candidate.stage !== 'merged');
  if (!task) return yield* new NothingToMeasure({ message: 'No open task to click on.' });
  const transcripts = yield* openTranscripts();
  const usage = process.memoryUsage();
  const result = {
    events: state.seq,
    tasks: Object.keys(state.tasks).length,
    runs: Object.keys(state.runs).length,
    sqliteBytes: yield* readData(() => statSync(join(SCRATCH, 'shinsa.sqlite')).size),
    bootColdMs: round(cold.bootMs),
    bootWarmMs: round(Duration.toMillis(warmFor)),
    snapshotWriteMs: cold.written ? round(cold.snapshotMs) : null,
    memory: { rssMb: round(usage.rss / 1e6), heapMb: round(usage.heapUsed / 1e6) },
    server: yield* measureServer(core, transcripts, task.id),
    roundTrip: yield* measureRoundTrip(core, transcripts, task.id),
    client: measureClientApply(yield* core.state),
    transcripts: yield* measureTranscripts(transcripts),
  };
  yield* Console.log(JSON.stringify(result, null, 2));
});

program.pipe(Effect.scoped, Effect.provide(JsonLogger), BunRuntime.runMain);
