import {
  type Bytes,
  createFrameSealer,
  createTeamWelcome,
  deriveTeamSessionKey,
  encodeText,
  parseTeamHello,
  REMOTE_KEY_ALGORITHM,
  type ShareMessage,
  serializePublicKey,
  serializeShareMessage,
  type TeamFeedTask,
  type TeamHello,
  verifyTeamHello,
} from '@shinsa/core';
import { Effect, Option } from 'effect';
import type { Socket } from 'effect/socket';
import type { TeamChannelTarget } from '@/lib/teams/team-socket/schema.ts';
import { createSocketTransport } from '../../support/engine-socket.ts';
import { createTask } from '../../support/state.ts';

export const TEAM_KEY = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';

export const TEAM_TARGET: TeamChannelTarget = {
  teamId: 'team1',
  instanceId: 'p7m2',
  key: TEAM_KEY,
  view: { kind: 'list' },
};

type Listener = (event: Socket.WebSocketEvent) => void;

export class FakeTeamSocket implements Socket.WebSocketLike {
  binaryType = 'blob';
  readyState = 0;
  closed = false;
  readonly url: string;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: string[] = [];
  readonly #answer: (socket: FakeTeamSocket, data: string) => Promise<void>;

  constructor(url: string, answer: (socket: FakeTeamSocket, data: string) => Promise<void>, opens = true) {
    this.url = url;
    this.#answer = answer;
    if (opens) queueMicrotask(() => this.emit('open', {}));
    else this.readyState = 1;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((known) => known !== listener)
    );
  }

  emit(type: string, event: Socket.WebSocketEvent) {
    if (type === 'open') this.readyState = 1;
    if (type === 'close') this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string | Uint8Array) {
    if (typeof data !== 'string') return;
    this.sent.push(data);
    void this.#answer(this, data);
  }

  close() {
    this.closed = true;
  }
}

export function createFakeTeamMachine() {
  let readied: () => void = () => undefined;
  const machine = {
    sockets: [] as FakeTeamSocket[],
    status: 200,
    key: TEAM_KEY,
    hellos: [] as TeamHello[],
    requests: [] as { url: string; body: unknown }[],
    seal: null as ((plain: Bytes) => Promise<Bytes>) | null,
    ready: new Promise<void>((resolve) => {
      readied = resolve;
    }),
    latest: () => {
      const socket = machine.sockets.at(-1);
      if (!socket) throw new Error('No socket was opened.');
      return socket;
    },
    answer: async (socket: FakeTeamSocket, data: string) => {
      const hello = Option.getOrNull(parseTeamHello(data));
      if (!(hello && (await Effect.runPromise(verifyTeamHello(machine.key, hello))))) {
        socket.emit('message', {
          data: JSON.stringify({ type: 'refused', reason: 'You are not in this team.' }),
        });
        return;
      }
      machine.hellos.push(hello);
      const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
      const keys = {
        team: hello.team,
        view: hello.view,
        clientEphemeral: hello.ephemeral,
        serverEphemeral: await Effect.runPromise(serializePublicKey(ephemeral.publicKey)),
      };
      const seal = createFrameSealer(
        await Effect.runPromise(
          deriveTeamSessionKey(machine.key, keys, ephemeral.privateKey, hello.ephemeral)
        )
      );
      machine.seal = (plain) => Effect.runPromise(seal(plain));
      socket.emit('message', {
        data: JSON.stringify(await Effect.runPromise(createTeamWelcome(machine.key, keys))),
      });
      readied();
    },
    send: async (message: ShareMessage) => {
      if (!machine.seal) throw new Error('The team channel is not open.');
      const frame = await machine.seal(encodeText(serializeShareMessage(message)));
      machine.latest().emit('message', { data: frame.buffer });
    },
    options: {
      fetch: async (request: Request) => {
        machine.requests.push({ url: new URL(request.url).pathname, body: await request.json() });
        if (machine.status !== 200) return new Response('', { status: machine.status });
        return Response.json({ url: 'wss://t-p7m2.shinsa.dev/team?token=t', expiresAt: 1 });
      },
      transport: createSocketTransport((url) => {
        const socket = new FakeTeamSocket(url, machine.answer);
        machine.sockets.push(socket);
        return socket;
      }),
    },
  };
  return machine;
}

export function createTeamFeedTask(overrides: Partial<TeamFeedTask> = {}): TeamFeedTask {
  return {
    task: createTask({ id: 'kai-task', title: 'Add the billing page', handle: 'PL-3', updatedAt: 10 }),
    gates: [],
    project: null,
    repo: null,
    owner: 'kai',
    machine: 'Studio',
    teamId: 'team1',
    instanceId: 'p7m2',
    ...overrides,
  };
}
