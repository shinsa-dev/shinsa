import { appendFileSync, cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Transcripts } from '../../apps/engine/src/agents/transcripts/index.ts';
import { createSocketHub, type SocketData } from '../../apps/engine/src/http/socket.ts';
import { Engine } from '../../apps/engine/src/runtime/engine.ts';
import { EventLog, resolveStateVersion } from '../../apps/engine/src/store/index.ts';
import {
  type ShinsaState,
  serializeState,
  type TaskPriority,
  type UserCommand,
} from '../../packages/core/src/index.ts';

interface PageConnection {
  start: () => void;
  snapshot: () => { state: ShinsaState | null };
  subscribe: (listener: () => void) => () => void;
  command: (command: UserCommand) => Promise<void>;
}

type PageConnectionOptions = {
  openSocket: () => WebSocket;
  retry: () => void;
  surface: () => 'browser';
  schedule: (flush: () => void) => void;
};

const PAGE_SOCKET = '../../apps/web/src/lib/connection/socket.ts';

async function createPageConnection(options: PageConnectionOptions) {
  const page = (await import(PAGE_SOCKET)) as {
    Connection: new (options: PageConnectionOptions) => PageConnection;
  };
  return new page.Connection(options);
}

interface Sample {
  values: number[];
}

function summarize({ values }: Sample) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return { p50: round(at(0.5)), p95: round(at(0.95)), max: round(at(1)), n: sorted.length };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function copyData(source: string, target: string) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

function sizeOf(path: string) {
  return statSync(path).size;
}

function timeBoot(dir: string, stateVersion: string | null) {
  const started = performance.now();
  const log = new EventLog(join(dir, 'shinsa.sqlite'));
  const engine = new Engine(log, { stateVersion });
  const ms = performance.now() - started;
  return { engine, log, ms };
}

function pickTask(state: ShinsaState) {
  const task = Object.values(state.tasks).find((candidate) => candidate.stage !== 'merged');
  if (!task) throw new Error('No open task to click on.');
  return task.id;
}

async function measureServer(engine: Engine, transcripts: Transcripts, taskId: string, clicks: number) {
  const hub = createSocketHub(engine, transcripts);
  const sent: number[] = [];
  const payloads: string[] = [];
  const socket = {
    data: {
      kind: 'hub',
      transcripts: new Map(),
      surface: null,
      origin: 'local',
      guest: null,
    } satisfies SocketData,
    send: (payload: string) => {
      sent.push(payload.length);
      payloads.push(payload);
    },
  } as unknown as Parameters<typeof hub.open>[0];
  hub.open(socket);
  const initialBytes = sent.reduce((sum, bytes) => sum + bytes, 0);
  const initial = payloads.find((payload) => payload.startsWith('{"type":"state"')) ?? '';
  sent.length = 0;
  payloads.length = 0;
  const latency: Sample = { values: [] };
  const cpuBefore = process.cpuUsage();
  for (let index = 0; index < clicks; index += 1) {
    const priority: TaskPriority = index % 2 === 0 ? 'high' : 'normal';
    const started = performance.now();
    await engine.dispatch({ type: 'task.prioritize', taskId, priority });
    latency.values.push(performance.now() - started);
  }
  const cpu = process.cpuUsage(cpuBefore);
  hub.close(socket);
  hub.stop();
  return {
    clientApplyMs: await measurePushes(initial, payloads),
    initialBytes,
    dispatchMs: summarize(latency),
    cpuMsPerCommand: round((cpu.user + cpu.system) / 1000 / clicks),
    bytesPerPush: summarize({ values: sent }),
  };
}

function startSocketServer(engine: Engine, transcripts: Transcripts) {
  const hub = createSocketHub(engine, transcripts);
  const server = Bun.serve<SocketData>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, bunServer) {
      if (
        bunServer.upgrade(request, {
          data: { kind: 'hub', transcripts: new Map(), surface: null, origin: 'local', guest: null },
        })
      )
        return undefined;
      return new Response('no', { status: 400 });
    },
    websocket: { open: hub.open, close: hub.close, message: hub.message, maxPayloadLength: 64 * 1024 * 1024 },
  });
  return {
    url: `ws://127.0.0.1:${server.port}/ws`,
    stop: async () => {
      hub.stop();
      await server.stop(true);
    },
  };
}

function waitFor(connection: PageConnection, check: (state: ShinsaState) => boolean) {
  return new Promise<void>((resolve) => {
    const current = connection.snapshot().state;
    if (current && check(current)) {
      resolve();
      return;
    }
    const unsubscribe = connection.subscribe(() => {
      const state = connection.snapshot().state;
      if (state && check(state)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function selectProject(state: ShinsaState) {
  const project = Object.values(state.projects)[0];
  if (!project) throw new Error('No project to rename.');
  return project;
}

async function measureRoundTrip(engine: Engine, transcripts: Transcripts, taskId: string, clicks: number) {
  const server = startSocketServer(engine, transcripts);
  const connectStarted = performance.now();
  const connection = await createPageConnection({
    openSocket: () => new WebSocket(server.url),
    retry: () => undefined,
    surface: () => 'browser',
    schedule: (flush) => queueMicrotask(flush),
  });
  connection.start();
  await waitFor(connection, () => true);
  const firstState = performance.now() - connectStarted;
  const visible: Sample = { values: [] };
  const confirmed: Sample = { values: [] };
  for (let index = 0; index < clicks; index += 1) {
    const priority: TaskPriority = index % 2 === 0 ? 'normal' : 'high';
    const command: UserCommand = { type: 'task.prioritize', taskId, priority };
    const started = performance.now();
    const shown = waitFor(connection, (state) => state.tasks[taskId]?.priority === priority).then(() =>
      visible.values.push(performance.now() - started)
    );
    await connection.command(command);
    confirmed.values.push(performance.now() - started);
    await shown;
  }
  const project = selectProject(engine.state);
  const serverSample: Sample = { values: [] };
  for (let index = 0; index < clicks; index += 1) {
    const description = `Round trip ${index}`;
    const started = performance.now();
    const shown = waitFor(
      connection,
      (state) => state.projects[project.id]?.description === description
    ).then(() => serverSample.values.push(performance.now() - started));
    await connection.command({ type: 'project.write', project: { ...project, description } });
    await shown;
  }
  await server.stop();
  return {
    firstStateMs: round(firstState),
    optimisticVisibleMs: summarize(visible),
    optimisticAckMs: summarize(confirmed),
    confirmedVisibleMs: summarize(serverSample),
  };
}

async function measureTranscripts(dir: string) {
  const transcripts = new Transcripts(join(dir, 'transcripts'));
  const files = readdirSync(join(dir, 'transcripts'))
    .map((name) => ({ name, size: sizeOf(join(dir, 'transcripts', name)) }))
    .sort((a, b) => b.size - a.size);
  const longest = files[0];
  if (!longest) return null;
  const runId = longest.name.replace(/\.jsonl$/, '');
  const started = performance.now();
  const entries = transcripts.listEntries(runId);
  const readMs = performance.now() - started;
  const bytes = JSON.stringify({ type: 'transcript', runId, entries }).length;
  const unfollow = transcripts.follow(runId);
  const append: Sample = { values: [] };
  let received = 0;
  const unsubscribe = transcripts.subscribe(() => {
    received += 1;
  });
  for (let index = 0; index < 50; index += 1) {
    const appendStarted = performance.now();
    transcripts.record(runId, { type: 'agent', phase: 'interim', text: `Still reading (${index}).` });
    append.values.push(performance.now() - appendStarted);
  }
  const external: Sample = { values: [] };
  for (let index = 0; index < 20; index += 1) {
    const before = received;
    const appendStarted = performance.now();
    appendFileSync(
      join(dir, 'transcripts', longest.name),
      `${JSON.stringify({ v: 2, id: `external-${index}`, at: index, type: 'agent', phase: 'interim', text: 'More.' })}\n`
    );
    while (received === before) await Bun.sleep(1);
    external.values.push(performance.now() - appendStarted);
  }
  unsubscribe();
  unfollow();
  return {
    externalAppendMs: summarize(external),
    entries: entries.length,
    fileBytes: longest.size,
    subscribeReadMs: round(readMs),
    subscribeBytes: bytes,
    appendMs: summarize(append),
    received,
  };
}

async function measurePushes(initial: string, payloads: string[]) {
  const core: Record<string, unknown> = await import('../../packages/core/src/index.ts');
  const applyPatch = core.applyStatePatch as
    | ((state: ShinsaState, patch: unknown) => ShinsaState)
    | undefined;
  let state = (JSON.parse(initial) as { state: ShinsaState }).state;
  const sample: Sample = { values: [] };
  for (const payload of payloads) {
    const started = performance.now();
    const message = JSON.parse(payload) as { type: string; state?: ShinsaState; patch?: unknown };
    if (message.type === 'state' && message.state) state = message.state;
    if (message.type === 'state.patch' && applyPatch) state = applyPatch(state, message.patch);
    sample.values.push(performance.now() - started);
  }
  return summarize(sample);
}

function measureParse(payload: string) {
  const sample: Sample = { values: [] };
  for (let index = 0; index < 20; index += 1) {
    const started = performance.now();
    JSON.parse(payload);
    sample.values.push(performance.now() - started);
  }
  return summarize(sample);
}

function measureClientApply(state: ShinsaState) {
  const full = JSON.stringify({ type: 'state', state });
  const wire = JSON.stringify({ type: 'state', state: serializeState(state) });
  return {
    fullStateBytes: full.length,
    fullStateParseMs: measureParse(full),
    wireStateBytes: wire.length,
    wireStateParseMs: measureParse(wire),
  };
}

function memory() {
  const usage = process.memoryUsage();
  return { rssMb: round(usage.rss / 1e6), heapMb: round(usage.heapUsed / 1e6) };
}

export async function runBench(source: string, scratch: string, clicks = 60) {
  copyData(source, scratch);
  const version = resolveStateVersion();
  const cold = timeBoot(scratch, version);
  const coldMs = cold.ms;
  const snapshotStarted = performance.now();
  const snapshotWritten = 'writeSnapshot' in cold.engine && cold.engine.writeSnapshot();
  const snapshotMs = performance.now() - snapshotStarted;
  cold.engine.stop();
  cold.log.close();
  const warm = timeBoot(scratch, version);
  Bun.gc(true);
  const engine = warm.engine;
  const taskId = pickTask(engine.state);
  const transcripts = new Transcripts(join(scratch, 'transcripts'));
  const result = {
    events: engine.state.seq,
    tasks: Object.keys(engine.state.tasks).length,
    runs: Object.keys(engine.state.runs).length,
    sqliteBytes: sizeOf(join(scratch, 'shinsa.sqlite')),
    bootColdMs: round(coldMs),
    bootWarmMs: round(warm.ms),
    snapshotWriteMs: snapshotWritten ? round(snapshotMs) : null,
    memory: memory(),
    server: await measureServer(engine, transcripts, taskId, clicks),
    roundTrip: await measureRoundTrip(engine, transcripts, taskId, clicks),
    client: measureClientApply(engine.state),
    transcripts: await measureTranscripts(scratch),
  };
  engine.stop();
  warm.log.close();
  return result;
}

if (import.meta.main) {
  const source = Bun.argv[2] ?? '/tmp/shinsa-perf/real/data';
  const scratch = Bun.argv[3] ?? '/tmp/shinsa-perf/scratch';
  console.log(JSON.stringify(await runBench(source, scratch), null, 2));
}
