import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { startServer } from '../../src/http/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { type ServiceRefiner, Terminals } from '../../src/terminals/index.ts';
import { createTestConfig, createTestOnboarding } from './index.ts';
import { createTempDir } from './temp.ts';

export const ORIGIN = 'http://localhost:5181';

export const NO_PREVIEW = { previewUrl: null, portVariable: 'PORT' };

const running: (() => Promise<void>)[] = [];

export async function stopTerminalServers() {
  for (const stop of running.splice(0)) await stop();
}

export async function startTerminalServer(options: { inspect?: boolean; refiner?: ServiceRefiner } = {}) {
  const root = createTempDir();
  const config = createTestConfig(root, { inspect: options.inspect ?? false });
  const engine = new Engine(new EventLog(config.databasePath));
  const terminals = new Terminals({
    dataDir: config.dataDir,
    home: root,
    version: '1.0.0',
    env: { SHELL: '/bin/sh', PATH: '/usr/bin:/bin', PS1: '$ ', HOME: root },
    notifyMs: 1,
  });
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
    terminals,
    ...(options.refiner ? { refiner: options.refiner } : {}),
  });
  running.push(async () => {
    await terminals.stop();
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
