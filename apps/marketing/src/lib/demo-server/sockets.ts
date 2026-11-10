import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  parseClientMessage,
  resolveEngineInfo,
  type ServerMessage,
  type ShinsaState,
  type UserCommand,
} from '@shinsa/core';
import { Option } from 'effect';
import { scheduleAfter } from '@/lib/runtime/timers.ts';
import { createHomeScene } from '../scene.ts';
import {
  type CommandListener,
  DEMO_ACK_DELAY_MS,
  DEMO_CLOSED,
  DEMO_CONNECTING,
  DEMO_ENGINE_VERSION,
  DEMO_OPEN,
} from './schema.ts';

const listeners = new Set<CommandListener>();
const transcripts = new Map<string, ChatEntry[]>();
const sockets = new Set<DemoSocket>();
let entryCount = 0;

class DemoSocket extends EventTarget {
  readyState = DEMO_CONNECTING;
  readonly #subscribed = new Set<string>();

  constructor() {
    super();
    sockets.add(this);
  }

  open(state: ShinsaState) {
    if (this.readyState !== DEMO_CONNECTING) return;
    this.readyState = DEMO_OPEN;
    this.dispatchEvent(new Event('open'));
    this.receive({ type: 'state', state });
    this.receive({ type: 'engine', engine: resolveEngineInfo(DEMO_ENGINE_VERSION) });
  }

  send(data: string | Uint8Array<ArrayBuffer>) {
    const message = typeof data === 'string' ? Option.getOrNull(parseClientMessage(data)) : null;
    if (message?.type === 'command') {
      scheduleAfter(DEMO_ACK_DELAY_MS, () => {
        this.receive({ type: 'ack', id: message.id, error: null });
        for (const listener of listeners) listener(message.command as UserCommand);
      });
      return;
    }
    if (message?.type === 'transcript.subscribe') {
      this.#subscribed.add(message.runId);
      this.receive({
        type: 'transcript',
        runId: message.runId,
        entries: transcripts.get(message.runId) ?? [],
        start: 0,
      });
      return;
    }
    if (message?.type === 'transcript.unsubscribe') this.#subscribed.delete(message.runId);
  }

  watches(runId: string) {
    return this.#subscribed.has(runId);
  }

  receive(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  close() {
    this.readyState = DEMO_CLOSED;
    sockets.delete(this);
  }
}

export function createDemoSocket() {
  return new DemoSocket();
}

export function openDemoSockets() {
  const state = createHomeScene(Date.now());
  for (const socket of sockets) socket.open(state);
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
