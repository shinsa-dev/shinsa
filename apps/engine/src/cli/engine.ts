import { DomainError } from '@shinsa/core';
import {
  BUNDLE,
  createServerInstance,
  describeVersion,
  type EngineService,
  type ServerHealth,
  type ShinsaBundle,
  STOP_DEADLINE_MS,
} from '../instance/index.ts';
import {
  type Display,
  describeFields,
  describeInline,
  describeMark,
  type Progress,
  type Tone,
} from '../terminal/index.ts';
import { createSurfaceClient } from './api.ts';

export interface EngineControl {
  bundled: boolean;
  service: EngineService;
  waitMs?: number;
}

export interface EngineIo extends EngineControl {
  base: string;
  display: Display;
  write: (line?: string) => void;
  startProgress: (text: string) => Progress;
}

export interface CommandVersion {
  version: string;
  commit: string | null;
}

export const HUMAN_ONLY_ENGINE_COMMANDS = ['stop', 'restart', 'engine'] as const;

const HEALTH_TIMEOUT_MS = 1000;

const ENGINE_WAIT_MS = 20_000;

const ENGINE_STOP_WAIT_MS = STOP_DEADLINE_MS + 10_000;

type EngineStop = 'stopped' | 'replaced' | 'forced';

const ENGINE_POLL_MS = 250;

export const ENGINE_STOPPED =
  'The engine is not running. `shinsa start` starts it, and so does opening the Shinsa app.';

export async function readHealth(base: string): Promise<ServerHealth | null> {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!response.ok) return null;
    return (await response.json()) as ServerHealth;
  } catch {
    return null;
  }
}

function describeEngine(health: ServerHealth) {
  return `Shinsa ${describeVersion(health)}, pid ${health.pid}`;
}

export function describeDuration(ms: number) {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function writeOutcome(io: EngineIo, tone: Tone, symbol: 'check' | 'dot', text: string, detail: string) {
  const { style } = io.display;
  const tail = detail ? ` ${style.dim(describeInline(style, detail))}` : '';
  io.write(describeMark(style, tone, symbol, `${text}${tail}`));
}

async function withProgress<T>(io: EngineIo, text: string, work: () => Promise<T>) {
  const progress = io.startProgress(text);
  const started = Date.now();
  try {
    const result = await work();
    return { result, took: describeDuration(Date.now() - started) };
  } finally {
    progress.stop();
  }
}

function describeWait(io: EngineControl, fallbackMs = ENGINE_WAIT_MS) {
  const seconds = Math.ceil((io.waitMs ?? fallbackMs) / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

async function waitFor<T>(io: EngineControl, check: () => Promise<T | null>, fallbackMs = ENGINE_WAIT_MS) {
  const deadline = Date.now() + (io.waitMs ?? fallbackMs);
  while (Date.now() < deadline) {
    const found = await check();
    if (found !== null) return found;
    await Bun.sleep(ENGINE_POLL_MS);
  }
  return null;
}

async function waitForEngine(io: EngineIo, accept: (health: ServerHealth) => boolean) {
  const health = await waitFor(io, async () => {
    const answer = await readHealth(io.base);
    return answer && accept(answer) ? answer : null;
  });
  if (!health) {
    throw new Error(`The engine did not answer within ${describeWait(io)}. \`shinsa logs\` shows why.`);
  }
  return health;
}

function assertManaged(io: EngineControl) {
  if (io.bundled) return;
  throw new DomainError(
    'engine_unmanaged',
    'This shinsa runs from source, so it does not start or stop the engine. `bun dev` runs the engine and Ctrl-C stops it.'
  );
}

async function assertEngineJob(io: EngineControl) {
  assertManaged(io);
  await io.service.assertInstalled();
}

export async function startEngine(io: EngineIo) {
  const running = await readHealth(io.base);
  if (running) {
    writeOutcome(io, 'success', 'dot', 'The engine is already running.', `${describeEngine(running)}.`);
    return;
  }
  assertManaged(io);
  const note = await io.service.prepare();
  const { result: health, took } = await withProgress(io, 'Starting the engine', async () => {
    await io.service.start();
    return waitForEngine(io, () => true);
  });
  writeOutcome(io, 'success', 'check', `Started the engine in ${took}.`, `${describeEngine(health)}.`);
  if (note) writeOutcome(io, 'info', 'dot', note, '');
}

export async function stopEngine(io: EngineIo) {
  await assertEngineJob(io);
  const before = await readHealth(io.base);
  if (!before) {
    writeOutcome(io, 'dim', 'dot', 'The engine is not running.', '');
    return;
  }
  const readStop = async (): Promise<EngineStop | null> => {
    const answer = await readHealth(io.base);
    if (!answer) return 'stopped';
    return answer.pid === before.pid ? null : 'replaced';
  };
  const { manager } = io.service;
  const { result: stop, took } = await withProgress(io, 'Stopping the engine', async () => {
    await io.service.stop();
    const clean = await waitFor(io, readStop, ENGINE_STOP_WAIT_MS);
    if (clean) return clean;
    await io.service.kill();
    if (await waitFor(io, readStop)) return 'forced';
    throw new Error(
      `The engine is still running after ${describeWait(io, ENGINE_STOP_WAIT_MS)} and a forced stop. \`shinsa logs\` shows why.`
    );
  });
  if (stop === 'replaced') {
    writeOutcome(
      io,
      'warning',
      'dot',
      `The engine did not stop cleanly in ${took}, so ${manager} started a fresh one.`,
      'Runs it cut off resume there. `shinsa logs` shows why it failed to stop.'
    );
    return;
  }
  if (stop === 'forced') {
    writeOutcome(
      io,
      'warning',
      'dot',
      `Forced the engine to stop in ${took}.`,
      io.service.revivesKilled
        ? `It did not stop on its own, so ${manager} starts a fresh one. Runs it cut off resume there. \`shinsa logs\` shows what held it.`
        : 'It did not stop on its own. Runs it cut off resume when it starts again. `shinsa logs` shows what held it.'
    );
    return;
  }
  writeOutcome(
    io,
    'success',
    'check',
    `Stopped the engine in ${took}.`,
    'Runs it cut off resume when it starts again: `shinsa start` or any command that needs it.'
  );
}

export async function restartEngine(io: EngineIo, whenIdle: boolean) {
  await assertEngineJob(io);
  const before = await readHealth(io.base);
  if (whenIdle) {
    if (!before) throw new DomainError('engine_stopped', ENGINE_STOPPED);
    const client = createSurfaceClient(io.base, `cli:${Bun.randomUUIDv7()}`);
    const answer = await client.post<{ restarting: boolean }>('/api/engine/restart', { when: 'idle' });
    if (!answer.restarting) {
      writeOutcome(io, 'info', 'dot', 'The engine restarts once no agent is mid-turn.', '');
      return;
    }
  }
  const { result: health, took } = await withProgress(io, 'Restarting the engine', async () => {
    if (!whenIdle) await io.service.restart();
    return waitForEngine(io, (answer) => answer.pid !== before?.pid);
  });
  writeOutcome(io, 'success', 'check', `Restarted the engine in ${took}.`, `${describeEngine(health)}.`);
}

export function resolveCommandVersion(bundle: ShinsaBundle | null = BUNDLE): CommandVersion {
  const instance = createServerInstance(bundle?.commit ?? null, 0, bundle);
  return { version: instance.version, commit: instance.commit };
}

export async function printVersion(io: EngineIo, json: boolean, bundle: ShinsaBundle | null = BUNDLE) {
  const command = resolveCommandVersion(bundle);
  const engine = await readHealth(io.base);
  if (json) {
    io.write(JSON.stringify({ command, engine }, null, 2));
    return;
  }
  const { style } = io.display;
  const engineLine = engine
    ? `${describeVersion(engine)}, ${style.dim(`pid ${engine.pid}, protocol ${engine.protocol}`)}`
    : describeMark(style, 'danger', 'dot', 'Not running');
  for (const line of describeFields(
    io.display,
    [
      ['Command', describeVersion(command)],
      ['Engine', engineLine],
    ],
    0
  )) {
    io.write(line);
  }
  if (engine && io.bundled && engine.version !== command.version) {
    io.write();
    io.write(
      describeMark(
        style,
        'warning',
        'warning',
        describeInline(
          style,
          'The engine runs another version than the app carries. `shinsa restart` starts the app’s.'
        )
      )
    );
  }
}
