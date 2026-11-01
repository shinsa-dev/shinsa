import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  applyStatePatch,
  applyTaskDetail,
  DEVELOPMENT_VERSION,
  type MachineResources,
  type RemoteSnapshot,
  resolveEngineInfo,
  type ServerMessage,
  serializeViewState,
  type TeamFeedSnapshot,
  type WireState,
} from '@shinsa/core';
import { Transcripts } from '../../src/agents/index.ts';
import { createSocketHub, type SocketData } from '../../src/http/socket.ts';
import type { Remote } from '../../src/remote/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

function createSocket() {
  const sent: ServerMessage[] = [];
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
      payloads.push(payload);
      return sent.push(JSON.parse(payload) as ServerMessage);
    },
  } as unknown as Parameters<ReturnType<typeof createSocketHub>['open']>[0];
  return { socket, sent, payloads };
}

function replayState(sent: ServerMessage[]) {
  let state: WireState | null = null;
  for (const message of sent) {
    if (message.type === 'state') state = message.state;
    if (message.type === 'state.patch' && state) state = applyStatePatch(state, message.patch);
    if (message.type === 'task.detail' && state) state = applyTaskDetail(state, message.detail);
  }
  return state;
}

function plain<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function createSettledTask(engine: Engine) {
  await engine.dispatch({ type: 'task.create', request: 'Keep the open one', repoId: null });
  await engine.dispatch({ type: 'task.create', request: 'Drop the old tabs', repoId: null });
  const [open, settled] = Object.keys(engine.state.tasks);
  await engine.dispatch({ type: 'task.cancel', taskId: settled ?? '' });
  return { open: open ?? '', settled: settled ?? '' };
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

  test('teammates’ task lists reach a socket on connect and again on every change', () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const listeners = new Set<() => void>();
    let teams: TeamFeedSnapshot = { machines: [], tasks: [] };
    const feeds = {
      snapshot: () => teams,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const hub = createSocketHub(
      engine,
      new Transcripts(join(dir, 'transcripts')),
      undefined,
      null,
      undefined,
      undefined,
      feeds
    );
    const { socket, sent } = createSocket();
    hub.open(socket);
    const machine = {
      teamId: 'team-1',
      instanceId: 'inst-2',
      name: 'Studio',
      userId: '7',
      status: 'live' as const,
      reason: null,
    };
    teams = { machines: [machine], tasks: [] };
    for (const listener of listeners) listener();
    expect(sent.filter((message) => message.type === 'teams')).toEqual([
      { type: 'teams', teams: { machines: [], tasks: [] } },
      { type: 'teams', teams: { machines: [machine], tasks: [] } },
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
      undefined,
      '1.4.0'
    );
    const { socket, sent } = createSocket();
    hub.open(socket);
    expect(sent.filter((message) => message.type === 'engine')).toEqual([
      { type: 'engine', engine: resolveEngineInfo('1.4.0') },
    ]);
    expect(sent.map((message) => message.type)).toEqual(['surfaces', 'engine', 'state']);
    hub.close(socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('samples resources only while a socket is open, and sends the last sample on connect', () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const listeners = new Set<(resources: MachineResources) => void>();
    let latest: MachineResources | null = null;
    const resources = {
      snapshot: () => latest,
      subscribe: (listener: (resources: MachineResources) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const hub = createSocketHub(
      engine,
      new Transcripts(join(dir, 'transcripts')),
      undefined,
      null,
      undefined,
      undefined,
      undefined,
      '1.4.0',
      resources
    );
    const first = createSocket();
    const second = createSocket();
    hub.open(first.socket);
    expect(first.sent.some((message) => message.type === 'resources')).toBe(false);
    hub.open(second.socket);
    expect(listeners.size).toBe(1);
    latest = {
      sampledAt: 1,
      cores: 4,
      cpuPercent: 20,
      memoryUsedBytes: 1,
      memoryTotalBytes: 2,
      diskFreeBytes: null,
      diskTotalBytes: null,
      tasks: [],
    };
    for (const listener of listeners) listener(latest);
    expect(second.sent.filter((message) => message.type === 'resources')).toEqual([
      { type: 'resources', resources: latest },
    ]);
    hub.close(first.socket);
    expect(listeners.size).toBe(1);
    hub.close(second.socket);
    expect(listeners.size).toBe(0);
    const third = createSocket();
    hub.open(third.socket);
    expect(third.sent.filter((message) => message.type === 'resources')).toEqual([
      { type: 'resources', resources: latest },
    ]);
    hub.stop();
    expect(listeners.size).toBe(0);
    engine.stop();
    log.close();
  });

  test('closes a socket whose message was dropped, and keeps the others', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    let closed = 0;
    const full = {
      data: {
        kind: 'hub',
        transcripts: new Map(),
        surface: null,
        origin: 'local',
        guest: null,
      } satisfies SocketData,
      send: () => 0,
      close: () => {
        closed += 1;
      },
    };
    const healthy = createSocket();
    hub.open(full);
    expect(closed).toBe(3);
    hub.open(healthy.socket);
    await startPlanning(engine);
    expect(closed).toBeGreaterThan(3);
    expect(healthy.sent.some((message) => message.type === 'state.patch')).toBe(true);
    hub.close(full);
    hub.close(healthy.socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('sends settled tasks as summaries, and each socket its own patch for them', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { open, settled } = await createSettledTask(engine);
    const summary = createSocket();
    const detail = createSocket();
    hub.open(summary.socket);
    hub.open(detail.socket);
    const connected = summary.sent.find((message) => message.type === 'state');
    expect(connected?.type === 'state' && connected.state.tasks[settled]?.summarized).toBe(true);
    expect(connected?.type === 'state' && connected.state.tasks[open]?.summarized).toBeUndefined();

    hub.message(detail.socket, JSON.stringify({ type: 'task.detail', taskId: settled }));
    await Promise.resolve();
    const answer = detail.sent.at(-1);
    expect(answer?.type === 'task.detail' && answer.detail).toMatchObject({
      taskId: settled,
      seq: engine.state.seq,
      task: { id: settled, stage: 'cancelled' },
    });
    expect(answer?.type === 'task.detail' ? answer.detail.task : null).toEqual(
      plain(engine.state.tasks[settled] ?? null)
    );

    const sharedFrom = summary.payloads.length;
    await engine.dispatch({ type: 'task.prioritize', taskId: open, priority: 'urgent' });
    expect(summary.payloads.slice(sharedFrom)).toEqual(detail.payloads.slice(-1));

    await engine.dispatch({ type: 'task.prioritize', taskId: settled, priority: 'low' });
    expect(summary.payloads.at(-1)).not.toEqual(detail.payloads.at(-1));
    expect(replayState(summary.sent)).toEqual(plain(serializeViewState(engine.state, new Set([settled]))));
    expect(replayState(detail.sent)).toEqual(plain(serializeViewState(engine.state, new Set())));

    hub.message(detail.socket, JSON.stringify({ type: 'state.sync' }));
    await Promise.resolve();
    await engine.dispatch({ type: 'task.prioritize', taskId: settled, priority: 'high' });
    expect(replayState(detail.sent)).toEqual(plain(serializeViewState(engine.state, new Set([settled]))));
    hub.close(summary.socket);
    hub.close(detail.socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('sends a guest its own task whole, scoped patches and no detail', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { settled } = await createSettledTask(engine);
    const guest = createSocket();
    guest.socket.data.guest = { taskId: settled, login: 'kai' };
    hub.open(guest.socket);
    const connected = guest.sent.find((message) => message.type === 'state');
    expect(connected?.type === 'state' && Object.keys(connected.state.tasks)).toEqual([settled]);
    expect(connected?.type === 'state' && connected.state.tasks[settled]?.summarized).toBeUndefined();

    hub.message(guest.socket, JSON.stringify({ type: 'task.detail', taskId: settled }));
    hub.message(guest.socket, JSON.stringify({ type: 'state.sync' }));
    await Promise.resolve();
    expect(guest.sent.some((message) => message.type === 'task.detail')).toBe(false);
    await engine.dispatch({ type: 'task.prioritize', taskId: settled, priority: 'low' });
    expect(replayState(guest.sent)?.tasks[settled]?.priority).toBe('low');
    hub.close(guest.socket);
    hub.stop();
    engine.stop();
    log.close();
  });

  test('answers a detail request for a task it no longer has, and ignores one without a task', async () => {
    const dir = createTempDir();
    const log = new EventLog(join(dir, 'shinsa.sqlite'));
    const engine = new Engine(log);
    const hub = createSocketHub(engine, new Transcripts(join(dir, 'transcripts')));
    const { socket, sent } = createSocket();
    hub.open(socket);
    hub.message(socket, JSON.stringify({ type: 'task.detail', taskId: 'gone' }));
    hub.message(socket, JSON.stringify({ type: 'task.detail' }));
    await Promise.resolve();
    const details = sent.filter((message) => message.type === 'task.detail');
    expect(details).toEqual([
      {
        type: 'task.detail',
        detail: { taskId: 'gone', seq: 0, task: null, runs: {}, gates: {}, evidence: {} },
      },
    ]);
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
