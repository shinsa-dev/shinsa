import {
  type Bytes,
  type ConnectResponse,
  createFrameOpener,
  createTeamHello,
  decodeText,
  deriveTeamSessionKey,
  parseShareMessage,
  parseShareWelcome,
  REMOTE_KEY_ALGORITHM,
  resolveTeamConnectPath,
  resolveTeamViewPath,
  type ShareMessage,
  type TeamView,
  type TeamViewTarget,
  verifyTeamWelcome,
} from '@shinsa/core';
import {
  createShareReceiver,
  type ShareReceiverOptions,
  type ShareSocket,
  type ShareStreamHandlers,
  toBytes,
  UNREADABLE_MESSAGE,
  waitFor,
} from '@/lib/share/live.ts';
import { ShareGoneError } from '@/lib/share/sources.ts';

export const TEAM_MACHINE_OFFLINE =
  'The teammate’s machine is offline. This page opens the task again as soon as it is back.';

export const TEAM_TASK_GONE =
  'This task is not shown to your team any more, or you are no longer in the team.';

const TEAM_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface TeamChannelEnd {
  reason: string;
  gone: boolean;
}

export interface TeamChannelHandlers {
  onMessage: (message: ShareMessage) => void;
  onEnd: (end: TeamChannelEnd) => void;
}

export type TeamTransport = (handlers: TeamChannelHandlers) => () => void;

export interface TeamChannelTarget {
  teamId: string;
  instanceId: string;
  key: string;
  view: TeamView;
}

export interface TeamChannelOptions {
  fetch?: typeof fetch;
  createSocket?: (url: string) => ShareSocket;
}

function createSocketWith(options: TeamChannelOptions) {
  return options.createSocket ?? ((url: string) => new WebSocket(url) as ShareSocket);
}

async function requestTeamChannelUrl(target: TeamChannelTarget, read: typeof fetch) {
  const response = await read(resolveTeamConnectPath(target.teamId), {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instanceId: target.instanceId }),
  });
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(TEAM_MACHINE_OFFLINE);
  return ((await response.json()) as ConnectResponse).url;
}

export function openTeamChannel(
  target: TeamChannelTarget,
  handlers: TeamChannelHandlers,
  options: TeamChannelOptions = {}
) {
  const read = options.fetch ?? fetch;
  const createSocket = createSocketWith(options);
  let socket: ShareSocket | null = null;
  let ended = false;

  const end = (result: TeamChannelEnd) => {
    if (ended) return;
    ended = true;
    socket?.close();
    socket = null;
    handlers.onEnd(result);
  };

  const begin = async () => {
    const url = await requestTeamChannelUrl(target, read);
    if (ended) return;
    if (!url) {
      end({ reason: TEAM_TASK_GONE, gone: true });
      return;
    }
    const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const hello = await createTeamHello(target.teamId, target.key, target.view, ephemeral.publicKey);
    if (ended) return;
    const opened = createSocket(url);
    socket = opened;
    opened.binaryType = 'arraybuffer';
    let openFrame: ((frame: Bytes) => Promise<Bytes>) | null = null;
    let queue: Promise<void> = Promise.resolve();
    const readWelcome = async (text: string) => {
      const welcome = parseShareWelcome(text);
      if (welcome?.type === 'refused') return end({ reason: welcome.reason, gone: true });
      if (welcome?.type !== 'welcome' || openFrame) return end({ reason: TEAM_MACHINE_OFFLINE, gone: false });
      const keys = {
        team: target.teamId,
        view: target.view,
        clientEphemeral: hello.ephemeral,
        serverEphemeral: welcome.ephemeral,
      };
      if (!(await verifyTeamWelcome(target.key, keys, welcome.proof)))
        return end({ reason: TEAM_TASK_GONE, gone: true });
      openFrame = createFrameOpener(
        await deriveTeamSessionKey(target.key, keys, ephemeral.privateKey, welcome.ephemeral)
      );
    };
    const readFrame = async (data: unknown) => {
      const frame = toBytes(data);
      if (!(frame && openFrame)) return end({ reason: TEAM_MACHINE_OFFLINE, gone: false });
      const message = parseShareMessage(decodeText(await openFrame(frame)));
      if (!message) return end({ reason: UNREADABLE_MESSAGE, gone: false });
      if (message.t === 'closed') return end({ reason: message.reason, gone: true });
      handlers.onMessage(message);
    };
    opened.addEventListener('open', () => opened.send(JSON.stringify(hello)));
    opened.addEventListener('close', () => {
      queue = queue.then(() => {
        if (socket === opened) end({ reason: TEAM_MACHINE_OFFLINE, gone: false });
      });
    });
    opened.addEventListener('message', (event) => {
      queue = queue.then(async () => {
        if (socket !== opened) return;
        try {
          if (typeof event.data === 'string') await readWelcome(event.data);
          else await readFrame(event.data);
        } catch {
          end({ reason: TEAM_MACHINE_OFFLINE, gone: false });
        }
      });
    });
  };

  begin().catch(() => end({ reason: TEAM_MACHINE_OFFLINE, gone: false }));
  return () => {
    ended = true;
    socket?.close();
    socket = null;
  };
}

export function resolveLocalTeamViewUrl(target: TeamViewTarget, origin: Pick<Location, 'protocol' | 'host'>) {
  const protocol = origin.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${origin.host}${resolveTeamViewPath(target)}`;
}

export function openLocalTeamView(
  target: TeamViewTarget,
  handlers: TeamChannelHandlers,
  options: TeamChannelOptions & { origin?: Pick<Location, 'protocol' | 'host'> } = {}
) {
  const socket = createSocketWith(options)(resolveLocalTeamViewUrl(target, options.origin ?? location));
  let ended = false;
  const end = (result: TeamChannelEnd) => {
    if (ended) return;
    ended = true;
    socket.close();
    handlers.onEnd(result);
  };
  socket.addEventListener('message', (event) => {
    if (ended) return;
    const message = typeof event.data === 'string' ? parseShareMessage(event.data) : null;
    if (!message) return end({ reason: UNREADABLE_MESSAGE, gone: false });
    if (message.t === 'closed') return end({ reason: message.reason, gone: true });
    handlers.onMessage(message);
  });
  socket.addEventListener('close', () => end({ reason: TEAM_MACHINE_OFFLINE, gone: false }));
  return () => {
    ended = true;
    socket.close();
  };
}

export function openTeamTaskStream(
  transport: TeamTransport,
  handlers: ShareStreamHandlers,
  options: ShareReceiverOptions & { wait?: (ms: number, run: () => void) => () => void } = {}
) {
  const wait = options.wait ?? waitFor;
  let attempt = 0;
  let stopped = false;
  let stopTransport: (() => void) | null = null;
  let cancelWait: (() => void) | null = null;
  const receiver = createShareReceiver((source) => {
    attempt = 0;
    handlers.onSource(source);
  }, options);

  function connect() {
    receiver.restart();
    stopTransport = transport({
      onMessage: (message) => {
        if (!stopped) receiver.receive(message);
      },
      onEnd: (end) => {
        stopTransport = null;
        if (stopped) return;
        if (end.gone) {
          stopped = true;
          handlers.onError(new ShareGoneError(end.reason));
          return;
        }
        handlers.onError(new Error(end.reason));
        const delay = TEAM_RETRY_MS[Math.min(attempt, TEAM_RETRY_MS.length - 1)] as number;
        attempt += 1;
        cancelWait = wait(delay, () => {
          cancelWait = null;
          if (!stopped) connect();
        });
      },
    });
  }

  connect();
  return () => {
    stopped = true;
    cancelWait?.();
    stopTransport?.();
    receiver.stop();
  };
}
