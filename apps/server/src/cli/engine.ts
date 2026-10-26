import { DomainError } from '@shinsa/core';
import {
  BUNDLE,
  createServerInstance,
  describeVersion,
  type ServerHealth,
  type ShinsaBundle,
} from '../instance/index.ts';
import { createSurfaceClient } from './api.ts';
import { resolveEngineTarget } from './app.ts';

interface LaunchctlResult {
  ok: boolean;
  output: string;
}

export interface EngineControl {
  bundled: boolean;
  uid: number;
  launchctl: (args: string[]) => Promise<LaunchctlResult>;
  waitMs?: number;
}

export interface EngineIo extends EngineControl {
  base: string;
  write: (line?: string) => void;
}

export const HUMAN_ONLY_ENGINE_COMMANDS = ['stop', 'restart', 'engine'] as const;

const HEALTH_TIMEOUT_MS = 1000;

const ENGINE_WAIT_MS = 20_000;

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

function describeWait(io: EngineControl) {
  const seconds = Math.ceil((io.waitMs ?? ENGINE_WAIT_MS) / 1000);
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}

async function waitFor<T>(io: EngineControl, check: () => Promise<T | null>) {
  const deadline = Date.now() + (io.waitMs ?? ENGINE_WAIT_MS);
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

async function runLaunchctl(io: EngineControl, args: string[]) {
  const result = await io.launchctl(args);
  if (!result.ok) throw new Error(`launchctl ${args[0]} failed: ${result.output.trim() || 'no output'}`);
}

async function assertEngineJob(io: EngineControl) {
  if (!io.bundled) {
    throw new DomainError(
      'engine_unmanaged',
      'This shinsa is not the one in the Shinsa app, so it does not start or stop the engine. From source, `bun dev` runs the engine and Ctrl-C stops it.'
    );
  }
  const printed = await io.launchctl(['print', resolveEngineTarget(io.uid)]);
  if (!printed.ok) {
    throw new DomainError(
      'engine_not_installed',
      'The engine is not set up yet. Open the Shinsa app once and it sets it up.'
    );
  }
}

export async function startEngine(io: EngineIo) {
  const running = await readHealth(io.base);
  if (running) {
    io.write(`The engine is already running: ${describeEngine(running)}.`);
    return;
  }
  await assertEngineJob(io);
  await runLaunchctl(io, ['kickstart', resolveEngineTarget(io.uid)]);
  const health = await waitForEngine(io, () => true);
  io.write(`Started the engine: ${describeEngine(health)}.`);
}

export async function stopEngine(io: EngineIo) {
  await assertEngineJob(io);
  if (!(await readHealth(io.base))) {
    io.write('The engine is not running.');
    return;
  }
  await runLaunchctl(io, ['kill', 'SIGTERM', resolveEngineTarget(io.uid)]);
  const stopped = await waitFor(io, async () => ((await readHealth(io.base)) ? null : true));
  if (!stopped) {
    throw new Error(`The engine is still stopping after ${describeWait(io)}. \`shinsa logs\` shows why.`);
  }
  io.write(
    'Stopped the engine. Runs it cut off resume when it starts again: `shinsa start`, the Shinsa app or any command that needs it.'
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
      io.write('The engine restarts once no agent is mid-turn.');
      return;
    }
  } else {
    await runLaunchctl(io, ['kickstart', '-k', resolveEngineTarget(io.uid)]);
  }
  const health = await waitForEngine(io, (answer) => answer.pid !== before?.pid);
  io.write(`Restarted the engine: ${describeEngine(health)}.`);
}

export function resolveCommandVersion(bundle: ShinsaBundle | null = BUNDLE) {
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
  io.write(`shinsa ${describeVersion(command)}`);
  if (!engine) {
    io.write('Engine: not running');
    return;
  }
  io.write(`Engine: ${describeEngine(engine)}, protocol ${engine.protocol}`);
  if (io.bundled && engine.version !== command.version) {
    io.write('The engine runs another version than the app carries. `shinsa restart` starts the app’s.');
  }
}
