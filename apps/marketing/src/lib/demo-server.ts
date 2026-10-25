import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  type ClientMessage,
  type ServerMessage,
  type ShinsaState,
  type UserCommand,
} from '@shinsa/core';
import { connection } from '@/lib/connection/socket.ts';
import { answerCodeRead } from './demo-repo.ts';
import { createHomeScene } from './scene.ts';

type CommandListener = (command: UserCommand) => void;

const listeners = new Set<CommandListener>();
const transcripts = new Map<string, ChatEntry[]>();
const sockets = new Set<DemoSocket>();
let entryCount = 0;
let installed = false;

const UNIFIED_KEY = 'shinsa.code-unified';

class DemoSocket extends EventTarget {
  readyState = 0;
  readonly #subscribed = new Set<string>();

  constructor() {
    super();
    sockets.add(this);
  }

  open(state: ShinsaState) {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
    this.receive({ type: 'state', state });
  }

  send(data: string) {
    const message = JSON.parse(data) as ClientMessage;
    if (message.type === 'command') {
      setTimeout(() => {
        this.receive({ type: 'ack', id: message.id, error: null });
        for (const listener of listeners) listener(message.command);
      }, 280);
      return;
    }
    if (message.type === 'transcript.subscribe') {
      this.#subscribed.add(message.runId);
      this.receive({
        type: 'transcript',
        runId: message.runId,
        entries: transcripts.get(message.runId) ?? [],
        start: 0,
      });
      return;
    }
    if (message.type === 'transcript.unsubscribe') this.#subscribed.delete(message.runId);
  }

  watches(runId: string) {
    return this.#subscribed.has(runId);
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close() {
    this.readyState = 3;
    sockets.delete(this);
  }
}

function isShinsaSocket(url: string | URL) {
  return new URL(String(url), location.href).pathname === '/ws';
}

function answerApi(url: URL): Response {
  const code = /^\/api\/tasks\/[^/]+\/([a-z]+)$/.exec(url.pathname);
  const body = code?.[1] ? answerCodeRead(code[1], url.searchParams) : null;
  if (body === null) {
    return Response.json(
      { error: { code: 'demo', message: 'This page only shows samples.' } },
      { status: 404 }
    );
  }
  return Response.json(body);
}

let apiInstalled = false;

export function installDemoApi() {
  if (apiInstalled) return;
  apiInstalled = true;
  const native = globalThis.fetch.bind(globalThis);
  const demoFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return native(input, init);
    return Promise.resolve(answerApi(url));
  };
  globalThis.fetch = Object.assign(demoFetch, { preconnect: globalThis.fetch.preconnect });
}

function createUuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as const;
}

function installUuid() {
  if (typeof crypto.randomUUID === 'function') return;
  crypto.randomUUID = createUuid as typeof crypto.randomUUID;
}

function keepPath(navigateHistory: History['pushState']): History['pushState'] {
  return (data, unused, url) => {
    if (url === undefined || url === null) {
      navigateHistory(data, unused);
      return;
    }
    const target = new URL(String(url), location.href);
    navigateHistory(data, unused, `${location.pathname}${target.search}${target.hash}`);
  };
}

function installHistoryGuard() {
  history.pushState = keepPath(history.pushState.bind(history));
  history.replaceState = keepPath(history.replaceState.bind(history));
}

let connected = false;

export function installDemoConnection() {
  if (connected) return;
  connected = true;
  const Native = globalThis.WebSocket;
  function DemoWebSocket(url: string | URL, protocols?: string | string[]) {
    return isShinsaSocket(url) ? new DemoSocket() : new Native(url, protocols);
  }
  Object.assign(DemoWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  globalThis.WebSocket = DemoWebSocket as unknown as typeof WebSocket;
  connection.start();
  const state = createHomeScene(Date.now());
  for (const socket of sockets) socket.open(state);
}

export function installDemoServer() {
  if (installed) return;
  installed = true;
  if (localStorage.getItem(UNIFIED_KEY) === null) localStorage.setItem(UNIFIED_KEY, 'true');
  installUuid();
  installHistoryGuard();
  installDemoApi();
  installDemoConnection();
}

export function onDemoCommand(listener: CommandListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function createEntry(event: ChatEvent): ChatEntry {
  entryCount += 1;
  return { ...event, v: CHAT_PROTOCOL_VERSION, id: `demo-${entryCount}`, at: Date.now() } as ChatEntry;
}

export function appendTranscript(runId: string, events: ChatEvent[]) {
  const entries = events.map(createEntry);
  const start = transcripts.get(runId)?.length ?? 0;
  transcripts.set(runId, [...(transcripts.get(runId) ?? []), ...entries]);
  for (const socket of sockets) {
    if (socket.watches(runId)) socket.receive({ type: 'transcript', runId, entries, start });
  }
}

export function resetTranscript(runId: string) {
  transcripts.delete(runId);
  for (const socket of sockets) {
    if (socket.watches(runId)) socket.receive({ type: 'transcript', runId, entries: [], start: 0 });
  }
}
