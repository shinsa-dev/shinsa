import { timingSafeEqual } from 'node:crypto';
import {
  PREVIEW_GONE,
  PREVIEW_ID_BYTES,
  PREVIEW_KEY_BYTES,
  PREVIEW_KEY_HEADER,
  PREVIEW_STOPPED,
  parsePreviewTunnelPath,
  parsePreviewUrl,
  selectServiceTerminal,
  serializeBase64Url,
  serializePreviewPage,
  serializePreviewUrl,
  type TerminalsSnapshot,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { EffectContext, Engine } from '../runtime/engine.ts';
import { EffectError } from '../runtime/failures.ts';
import type { Remote } from './index.ts';

export const PREVIEW_NOT_PAIRED =
  'Turn on remote access in Settings → General to share this preview. Its link works once this machine is paired.';

export const PREVIEW_LINK_LOST =
  'This machine was paired with remote access again, so the old link no longer reaches it. Share this preview again for a new link.';

export const PREVIEW_NO_URL =
  'This service has no preview URL, so there is no page to share. Give it one in its settings, then share it again.';

const FINAL = { retryable: false, delayMs: null };

const DROPPED_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cdn-loop',
  PREVIEW_KEY_HEADER,
]);

const SOCKET_HEADERS: ReadonlySet<string> = new Set([
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-extensions',
  'sec-websocket-protocol',
]);

const SENDABLE_CLOSE = { min: 1000, max: 4999, reserved: new Set([1004, 1005, 1006, 1015]) };

export interface PreviewServices {
  snapshot: () => TerminalsSnapshot;
}

export interface PreviewEffects {
  link: (taskId: string, serviceId: string, context: EffectContext) => Promise<void>;
}

export interface PreviewUpgrade {
  previewId: string;
  target: string;
  headers: Record<string, string>;
  protocols: string[];
}

export type PreviewAnswer =
  | { kind: 'response'; response: Response }
  | { kind: 'upgrade'; upgrade: PreviewUpgrade };

export interface PreviewPeer {
  send: (data: string | Uint8Array) => void;
  close: (code: number, reason: string) => void;
}

export interface PreviewRelay {
  send: (data: string | Uint8Array) => void;
  close: () => void;
}

export interface PreviewLinks {
  answer: (request: Request, url: URL) => Promise<PreviewAnswer>;
  openSocket: (peer: PreviewPeer, upgrade: PreviewUpgrade) => PreviewRelay;
}

export interface PreviewsOptions {
  engine: Engine;
  remote: Remote;
  services: PreviewServices;
  origin: string;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
  fetch?: typeof fetch;
}

interface PreviewShareTarget {
  taskId: string;
  serviceId: string;
  key: string;
}

interface LiveSocket {
  previewId: string;
  peer: PreviewPeer;
  upstream: WebSocket;
}

function createRandom(bytes: number) {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

function respondPage(message: string, status: number) {
  return new Response(serializePreviewPage(message), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function isKey(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function resolveLocalOrigin(port: number) {
  return `http://localhost:${port}`;
}

function rewriteOrigin(value: string, port: number) {
  try {
    const url = new URL(value);
    return `${resolveLocalOrigin(port)}${url.pathname}${url.search}`;
  } catch {
    return resolveLocalOrigin(port);
  }
}

export function resolveForwardHeaders(source: Headers, port: number) {
  const headers: Record<string, string> = {};
  for (const [name, value] of source) {
    if (DROPPED_HEADERS.has(name) || name.startsWith('cf-')) continue;
    headers[name] = value;
  }
  headers.host = `localhost:${port}`;
  if (headers.origin) headers.origin = resolveLocalOrigin(port);
  if (headers.referer) headers.referer = rewriteOrigin(headers.referer, port);
  return headers;
}

export function resolveReturnHeaders(source: Headers, port: number) {
  const headers = new Headers();
  for (const [name, value] of source) {
    if (DROPPED_HEADERS.has(name)) continue;
    headers.append(name, value);
  }
  const location = headers.get('location');
  const local = resolveLocalOrigin(port);
  const loopback = `http://127.0.0.1:${port}`;
  for (const prefix of [local, loopback]) {
    if (location?.startsWith(prefix)) headers.set('location', location.slice(prefix.length) || '/');
  }
  return headers;
}

export function resolveCloseCode(code: number) {
  const { min, max, reserved } = SENDABLE_CLOSE;
  return code >= min && code <= max && !reserved.has(code) ? code : 1000;
}

function isUpgrade(request: Request) {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket';
}

function listProtocols(request: Request) {
  const header = request.headers.get('sec-websocket-protocol');
  if (!header) return [];
  return header
    .split(',')
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

export class Previews implements PreviewEffects, PreviewLinks {
  readonly #engine: Engine;
  readonly #remote: Remote;
  readonly #services: PreviewServices;
  readonly #origin: string;
  readonly #now: () => number;
  readonly #random: (bytes: number) => Uint8Array<ArrayBuffer>;
  readonly #fetch: typeof fetch;
  readonly #sockets = new Set<LiveSocket>();
  #pairedAs: string | null;

  constructor(options: PreviewsOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#services = options.services;
    this.#origin = options.origin;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? createRandom;
    this.#fetch = options.fetch ?? fetch;
    this.#pairedAs = this.#selectInstanceId();
    options.remote.subscribe(() => this.#syncRemote());
    options.engine.subscribe(() => this.#syncSockets());
  }

  #selectInstanceId() {
    return this.#remote.store.file.credentials?.instanceId ?? null;
  }

  #syncRemote() {
    this.#syncSockets();
    const before = this.#pairedAs;
    this.#pairedAs = this.#selectInstanceId();
    if (before === null || before === this.#pairedAs) return;
    for (const task of Object.values(this.#engine.state.tasks)) {
      for (const preview of task.previews ?? []) {
        if (!preview.url || preview.failure) continue;
        const command = {
          type: 'preview.fail',
          taskId: task.id,
          serviceId: preview.serviceId,
          detail: PREVIEW_LINK_LOST,
        } as const;
        this.#engine.dispatch(command).catch((error: unknown) => {
          log.error('[Preview] Could not mark a link as lost', {
            taskId: task.id,
            serviceId: preview.serviceId,
            error: describeError(error),
          });
        });
      }
    }
  }

  #syncSockets() {
    for (const socket of [...this.#sockets]) {
      if (this.#remote.isEnabled && this.#resolveShare(socket.previewId)) continue;
      this.#sockets.delete(socket);
      socket.peer.close(1000, PREVIEW_GONE);
      socket.upstream.close();
    }
  }

  #resolveShare(previewId: string): PreviewShareTarget | null {
    const instanceId = this.#selectInstanceId();
    if (!instanceId) return null;
    for (const task of Object.values(this.#engine.state.tasks)) {
      for (const preview of task.previews ?? []) {
        if ((preview.endsAt ?? Number.POSITIVE_INFINITY) <= this.#now()) continue;
        const link = parsePreviewUrl(preview.url, this.#origin);
        if (link?.previewId === previewId && link.instanceId === instanceId)
          return { taskId: task.id, serviceId: preview.serviceId, key: link.key };
      }
    }
    return null;
  }

  async link(taskId: string, serviceId: string, context: EffectContext) {
    const preview = this.#engine.state.tasks[taskId]?.previews?.find((each) => each.serviceId === serviceId);
    if (!preview) return;
    const credentials = this.#remote.store.file.credentials;
    if (!credentials) throw new EffectError(PREVIEW_NOT_PAIRED, PREVIEW_NOT_PAIRED, FINAL);
    const service = this.#services.snapshot().services.find((each) => each.id === serviceId);
    if (!service?.previewUrl) throw new EffectError(PREVIEW_NO_URL, PREVIEW_NO_URL, FINAL);
    const current = parsePreviewUrl(preview.url, this.#origin);
    const url =
      current?.instanceId === credentials.instanceId
        ? null
        : serializePreviewUrl(
            {
              instanceId: credentials.instanceId,
              previewId: serializeBase64Url(this.#random(PREVIEW_ID_BYTES)),
              key: serializeBase64Url(this.#random(PREVIEW_KEY_BYTES)),
            },
            this.#origin
          );
    await this.#engine.dispatch(
      { type: 'preview.record', taskId, serviceId, url },
      { id: `${context.key}:preview.record` }
    );
  }

  async answer(request: Request, url: URL): Promise<PreviewAnswer> {
    const parsed = parsePreviewTunnelPath(url.pathname);
    const share = parsed ? this.#resolveShare(parsed.previewId) : null;
    if (!(parsed && share && isKey(request.headers.get(PREVIEW_KEY_HEADER), share.key)))
      return { kind: 'response', response: respondPage(PREVIEW_GONE, 404) };
    const run = selectServiceTerminal(this.#services.snapshot(), share.serviceId, share.taskId);
    if (!(run?.status === 'running' && run.port))
      return { kind: 'response', response: respondPage(PREVIEW_STOPPED, 503) };
    const path = `${parsed.path}${url.search}`;
    const headers = resolveForwardHeaders(request.headers, run.port);
    if (isUpgrade(request)) {
      for (const name of SOCKET_HEADERS) delete headers[name];
      const target = `ws://localhost:${run.port}${path}`;
      return {
        kind: 'upgrade',
        upgrade: { previewId: parsed.previewId, target, headers, protocols: listProtocols(request) },
      };
    }
    return {
      kind: 'response',
      response: await this.#forward(request, `${resolveLocalOrigin(run.port)}${path}`, headers, run.port),
    };
  }

  async #forward(request: Request, target: string, headers: Record<string, string>, port: number) {
    const bodyless = request.method === 'GET' || request.method === 'HEAD';
    try {
      const response = await this.#fetch(target, {
        method: request.method,
        headers,
        body: bodyless ? null : request.body,
        redirect: 'manual',
        decompress: false,
      });
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: resolveReturnHeaders(response.headers, port),
      });
    } catch (error) {
      log.warn('[Preview] Could not reach the service', { target, error: describeError(error) });
      return respondPage(PREVIEW_STOPPED, 502);
    }
  }

  openSocket(peer: PreviewPeer, upgrade: PreviewUpgrade): PreviewRelay {
    const upstream = new WebSocket(upgrade.target, {
      headers: upgrade.headers,
      protocols: upgrade.protocols,
    });
    upstream.binaryType = 'arraybuffer';
    const live: LiveSocket = { previewId: upgrade.previewId, peer, upstream };
    const pending: (string | Uint8Array)[] = [];
    this.#sockets.add(live);
    upstream.onopen = () => {
      for (const data of pending.splice(0)) upstream.send(data);
    };
    upstream.onmessage = (event) => {
      const { data } = event as MessageEvent<string | ArrayBuffer>;
      peer.send(typeof data === 'string' ? data : new Uint8Array(data));
    };
    upstream.onclose = (event) => {
      if (!this.#sockets.delete(live)) return;
      peer.close(resolveCloseCode(event.code), event.reason);
    };
    return {
      send: (data) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
        else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
      },
      close: () => {
        this.#sockets.delete(live);
        upstream.close();
      },
    };
  }
}
