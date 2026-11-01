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
import type { ShareSocket } from '@/lib/share/live.ts';
import type { TeamChannelTarget } from '@/lib/teams/channel.ts';
import { createTask } from '../../support/state.ts';

export const TEAM_KEY = 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk';

export const TEAM_TARGET: TeamChannelTarget = {
  teamId: 'team1',
  instanceId: 'p7m2',
  key: TEAM_KEY,
  view: { kind: 'list' },
};

type Listener = (event: { data?: unknown }) => void;

export class FakeTeamSocket implements ShareSocket {
  binaryType = 'blob';
  closed = false;
  readonly url: string;
  readonly listeners = new Map<string, Listener[]>();
  readonly sent: string[] = [];
  readonly #answer: (socket: FakeTeamSocket, data: string) => Promise<void>;

  constructor(url: string, answer: (socket: FakeTeamSocket, data: string) => Promise<void>, opens = true) {
    this.url = url;
    this.#answer = answer;
    if (opens) queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, event: { data?: unknown }) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  send(data: string) {
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
      const hello = parseTeamHello(data);
      if (!(hello && (await verifyTeamHello(machine.key, hello)))) {
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
        serverEphemeral: await serializePublicKey(ephemeral.publicKey),
      };
      machine.seal = createFrameSealer(
        await deriveTeamSessionKey(machine.key, keys, ephemeral.privateKey, hello.ephemeral)
      );
      socket.emit('message', { data: JSON.stringify(await createTeamWelcome(machine.key, keys)) });
      readied();
    },
    send: async (message: ShareMessage) => {
      if (!machine.seal) throw new Error('The team channel is not open.');
      const frame = await machine.seal(encodeText(serializeShareMessage(message)));
      machine.latest().emit('message', { data: frame.buffer });
    },
    options: {
      fetch: ((url: string, init?: RequestInit) => {
        machine.requests.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        if (machine.status !== 200) return Promise.resolve(new Response('', { status: machine.status }));
        return Promise.resolve(Response.json({ url: 'wss://t-p7m2.shinsa.dev/team?token=t', expiresAt: 1 }));
      }) as unknown as typeof fetch,
      createSocket: (url: string) => {
        const socket = new FakeTeamSocket(url, machine.answer);
        machine.sockets.push(socket);
        return socket;
      },
    },
  };
  return machine;
}

export function createTeamFeedTask(overrides: Partial<TeamFeedTask> = {}): TeamFeedTask {
  return {
    task: createTask({ id: 'kai-task', title: 'Add the billing page', handle: 'PL-3', updatedAt: 10 }),
    gates: [],
    project: null,
    owner: 'kai',
    machine: 'Studio',
    teamId: 'team1',
    instanceId: 'p7m2',
    ...overrides,
  };
}
