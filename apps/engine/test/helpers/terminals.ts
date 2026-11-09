import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Context, Duration, Effect, Exit, Layer, Scope } from 'effect';
import type { ModelSource } from '../../src/agents/index.ts';
import type { QuickJson } from '../../src/agents/quick/schema.ts';
import type { ServerConfig } from '../../src/config/index.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { ShellLayer } from '../../src/shell/layers.ts';
import { ServiceRefiner, Terminals, TerminalTimings } from '../../src/terminals/index.ts';
import { TerminalsLayer } from '../../src/terminals/layers.ts';
import { Engine } from './engine.ts';
import { openEventLog } from './event-log.ts';
import { createTestEvidence } from './evidence.ts';
import { JsonFileLayer } from './files.ts';
import { createTestConfig, createTestOnboarding } from './index.ts';
import { createTempDir } from './temp.ts';
import { createTestTranscripts } from './transcripts.ts';
import { startHttpServer } from './web.ts';

export const ORIGIN = 'http://localhost:5181';

export const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

const running: (() => Promise<void>)[] = [];

export async function startRealTerminals(config: ServerConfig, home: string) {
  const scope = Effect.runSync(Scope.make());
  const built = await Effect.runPromise(
    Layer.buildWithScope(
      Terminals.layer({
        version: '1.0.0',
        env: { SHELL: '/bin/sh', PATH: '/usr/bin:/bin', PS1: '$ ', HOME: home },
      }).pipe(
        Layer.provide(TerminalsLayer),
        Layer.provide(
          Layer.mergeAll(
            ShellLayer,
            JsonFileLayer,
            Layer.succeed(EngineConfig, config),
            Layer.succeed(TerminalTimings, { notify: Duration.millis(1), screen: Duration.seconds(2) })
          )
        )
      ),
      scope
    )
  );
  return {
    terminals: Context.get(built, Terminals),
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
}

export function createTestRefiner(ask: QuickJson) {
  const layer = ServiceRefiner.layer(ask).pipe(Layer.provide(BunServices.layer));
  return Effect.runSync(ServiceRefiner.use(Effect.succeed).pipe(Effect.provide(layer)));
}

export async function stopTerminalServers() {
  for (const stop of running.splice(0)) await stop();
}

export async function startTerminalServer(
  options: { inspect?: boolean; refiner?: ServiceRefiner['Service'] } = {}
) {
  const root = createTempDir();
  const config = createTestConfig(root, { inspect: options.inspect ?? false });
  const engine = new Engine(openEventLog(config.databasePath));
  const { terminals, close } = await startRealTerminals({ ...config, userHome: root }, root);
  const http = startHttpServer({
    engine,
    config,
    transcripts: createTestTranscripts(config.transcriptsDir),
    evidence: createTestEvidence(config.evidenceDir),
    models: { listModels: Effect.succeed([]) } as unknown as ModelSource,
    onboarding: (await createTestOnboarding(engine, config)).onboarding,
    terminals,
    ...(options.refiner ? { refiner: options.refiner } : {}),
  });
  running.push(async () => {
    await close();
    await http.stop();
  });
  const repoPath = join(root, 'web');
  mkdirSync(repoPath);
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'web', path: repoPath, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: 'Shop',
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  const base = `http://127.0.0.1:${http.server.port}`;
  const post = (path: string, body: unknown, origin: string | null = ORIGIN) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  const read = async <T>(path: string) => (await (await fetch(`${base}${path}`)).json()) as T;
  return { base, post, read, projectId, repoPath, terminals, engine, root };
}

export function openSocket(url: string, origin: string | null) {
  const options = { headers: origin ? { origin } : {} };
  return new WebSocket(url, options as unknown as string[]);
}

export function attachTerminal(base: string, id: string, origin: string | null = ORIGIN) {
  const socket = openSocket(`${base.replace('http', 'ws')}/ws/terminals/${id}`, origin);
  socket.binaryType = 'arraybuffer';
  const decoder = new TextDecoder();
  const state = { output: '', controls: [] as unknown[], closed: null as number | null };
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') state.controls.push(JSON.parse(event.data));
    else state.output += decoder.decode(event.data as ArrayBuffer, { stream: true });
  });
  socket.addEventListener('close', (event) => {
    state.closed = event.code;
  });
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('socket refused')));
  });
  return { socket, state, opened };
}
