import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  DEVELOPMENT_VERSION,
  type RemoteSnapshot,
  resolveEngineInfo,
  type ServerMessage,
} from '@shinsa/core';
import { Transcripts } from '../../src/agents/index.ts';
import { createSocketHub, type SocketData } from '../../src/http/socket.ts';
import type { Remote } from '../../src/remote/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

function createSocket() {
  const sent: ServerMessage[] = [];
  const socket = {
    data: {
      kind: 'hub',
      transcripts: new Map(),
      surface: null,
      origin: 'local',
      guest: null,
    } satisfies SocketData,
    send: (payload: string) => sent.push(JSON.parse(payload) as ServerMessage),
  } as unknown as Parameters<ReturnType<typeof createSocketHub>['open']>[0];
  return { socket, sent };
}

async function startPlanning(engine: Engine) {
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: 'app', path: '/code/app', defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: null,
  });
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll', repoId: null });
  const taskId = Object.keys(engine.state.tasks)[0] ?? '';
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId,
    title: 'Fix',
    repoId,
    size: 'small',
    branch: 'fix/a',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId, path: '/wt/a', branch: 'fix/a' });
}

describe('the socket hub', () => {
  test('sends runs without their prompts, on connect, in every patch and on a sync', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { socket, sent } = createSocket();
    await startPlanning(engine);
    const run = Object.values(engine.state.runs)[0];
    expect(run?.prompt).toBeString();
    hub.open(socket);
    await engine.dispatch({ type: 'task.prioritize', taskId: run?.taskId ?? '', priority: 'urgent' });
    await engine.dispatch({
      type: 'run.link',
      runId: run?.id ?? '',
      sessionId: 'session-1',
      provider: 'claude',
    });
    hub.message(socket, JSON.stringify({ type: 'state.sync' }));
    await Promise.resolve();
    const states = sent.filter((message) => message.type === 'state');
    expect(states).toHaveLength(2);
    expect(states[0]?.type === 'state' && states[0].state.runs[run?.id ?? '']).toMatchObject({
      id: run?.id,
      purpose: 'plan',
    });
    const patches = sent.flatMap((message) => (message.type === 'state.patch' ? [message.patch] : []));
    expect(patches.some((patch) => patch.records.runs?.[run?.id ?? ''])).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('"prompt"');
    expect(JSON.stringify(sent)).not.toContain('"rolePrompt"');
    hub.close(socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('a new Home guide reaches every socket as a patch at the same position in the log', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { socket, sent } = createSocket();
    hub.open(socket);
    await engine.dispatch({ type: 'focus.change', projectId: null, until: 1 });
    const briefing = { now: null, next: [], running: 'No agent is working right now.', note: null };
    await engine.writeBriefing(null, { text: 'Nothing needs you right now.', briefing });
    const last = sent.at(-1);
    expect(last?.type === 'state.patch' && last.patch).toMatchObject({
      from: 1,
      to: 1,
      fields: {},
      records: { briefings: { '*': { put: { text: 'Nothing needs you right now.', briefing } } } },
    });
    hub.close(socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('remote access reaches a socket on connect and again on every change', () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const listeners = new Set<() => void>();
    let snapshot = { paired: true, devices: [] } as unknown as RemoteSnapshot;
    const remote = {
      snapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Remote;
    const hub = createSocketHub(
      engine,
      new Transcripts(join(dir, 'transcripts')),
      undefined,
      null,
      undefined,
      remote
    );
    const { socket, sent } = createSocket();
    hub.open(socket);
    snapshot = { ...snapshot, enabled: false };
    for (const listener of listeners) listener();
    expect(sent.filter((message) => message.type === 'remote')).toEqual([
      { type: 'remote', remote: { paired: true, devices: [] } as unknown as RemoteSnapshot },
      { type: 'remote', remote: snapshot },
    ]);
    hub.close(socket);
    hub.stop();
    expect(listeners.size).toBe(0);
    engine.stop();
    log.close();
  });

  test('tells every socket on connect which build it talks to and what it speaks', () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(
      engine,
      new Transcripts(join(dir, 'transcripts')),
      undefined,
      null,
      undefined,
      undefined,
      '1.4.0'
    );
    const { socket, sent } = createSocket();
    hub.open(socket);
    expect(sent.filter((message) => message.type === 'engine')).toEqual([
      { type: 'engine', engine: resolveEngineInfo('1.4.0') },
    ]);
    expect(sent.at(-1)?.type).toBe('engine');
    hub.close(socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('announces a development build when it is given no version', () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { socket, sent } = createSocket();
    hub.open(socket);
    const announced = sent.find((message) => message.type === 'engine');
    expect(announced?.type === 'engine' && announced.engine.version).toBe(DEVELOPMENT_VERSION);
    hub.close(socket);
    hub.stop();
    engine.stop();
    log.close();
  });
});
