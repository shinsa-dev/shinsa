import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  createFrameSealer,
  createShareWelcome,
  deriveShareSessionKey,
  encodeText,
  parseShareHello,
  REMOTE_KEY_ALGORITHM,
  type ShareFileType,
  type ShareLiveView,
  type ShareMessage,
  type ShareWelcome,
  serializeBase64Url,
  serializePublicKey,
  serializeShareMessage,
  verifyShareHello,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { ChannelPeer } from './channel.ts';

export const SHARE_GONE_REASON = 'This task is no longer shared, or the link is wrong.';

const POLICY_VIOLATION = 1008;

const NORMAL_CLOSE = 1000;

export interface LiveFile {
  id: string;
  version: string;
  type: ShareFileType;
  read: () => Promise<Bytes>;
}

export interface LiveShare {
  view: ShareLiveView;
  files: LiveFile[];
}

export interface ShareChannelHost {
  resolveShare: (shareId: string) => { taskId: string; key: string } | null;
  resolveLive: (taskId: string) => Promise<LiveShare>;
}

type ChannelState =
  | { kind: 'hello' }
  | { kind: 'open'; taskId: string; seal: (plain: Bytes) => Promise<Bytes> }
  | { kind: 'closed' };

function serializeViewKey(view: ShareLiveView) {
  return JSON.stringify({ ...view, updatedAt: 0 });
}

export class ShareChannel {
  readonly shareId: string;
  readonly #peer: ChannelPeer;
  readonly #host: ShareChannelHost;
  readonly #sent = new Map<string, string>();
  #state: ChannelState = { kind: 'hello' };
  #lastView: string | null = null;
  #queue: Promise<void> = Promise.resolve();
  #pushing = false;
  #dirty = false;

  constructor(peer: ChannelPeer, shareId: string, host: ShareChannelHost) {
    this.#peer = peer;
    this.shareId = shareId;
    this.#host = host;
  }

  get taskId() {
    return this.#state.kind === 'open' ? this.#state.taskId : null;
  }

  receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    this.#queue = this.#queue.then(async () => {
      try {
        await this.#receive(raw);
      } catch (error) {
        this.fail('The share link broke.', error);
      }
    });
    return this.#queue;
  }

  async #receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    if (this.#state.kind === 'closed') return;
    if (this.#state.kind === 'open') {
      this.fail('A share link only listens.');
      return;
    }
    const hello = typeof raw === 'string' ? parseShareHello(raw) : null;
    if (!hello || hello.share !== this.shareId) {
      this.fail('The share link expects a hello first.');
      return;
    }
    const share = this.#host.resolveShare(hello.share);
    if (!(share && (await verifyShareHello(share.key, hello)))) {
      this.#refuse(SHARE_GONE_REASON);
      return;
    }
    const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const keys = {
      share: hello.share,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: await serializePublicKey(ephemeral.publicKey),
    };
    const session = await deriveShareSessionKey(share.key, keys, ephemeral.privateKey, hello.ephemeral);
    const welcome = await createShareWelcome(share.key, keys);
    if (this.#state.kind !== 'hello') return;
    this.#state = { kind: 'open', taskId: share.taskId, seal: createFrameSealer(session) };
    this.#peer.send(JSON.stringify(welcome));
    await this.push();
  }

  #refuse(reason: string) {
    this.#peer.send(JSON.stringify({ type: 'refused', reason } satisfies ShareWelcome));
    this.fail(reason);
  }

  async #send(message: ShareMessage) {
    const state = this.#state;
    if (state.kind !== 'open') return;
    const frame = await state.seal(encodeText(serializeShareMessage(message)));
    if (this.#state.kind === 'open') this.#peer.send(frame);
  }

  async push() {
    this.#dirty = true;
    if (this.#pushing) return;
    this.#pushing = true;
    try {
      while (this.#dirty && this.#state.kind === 'open') {
        this.#dirty = false;
        await this.#pushOnce(this.#state.taskId);
      }
    } catch (error) {
      this.fail('The share link broke.', error);
    } finally {
      this.#pushing = false;
    }
  }

  async #pushOnce(taskId: string) {
    const live = await this.#host.resolveLive(taskId);
    const key = serializeViewKey(live.view);
    if (key !== this.#lastView) {
      this.#lastView = key;
      await this.#send({ t: 'view', data: JSON.stringify(live.view) });
    }
    for (const file of live.files) {
      if (this.#sent.get(file.id) === file.version) continue;
      this.#sent.set(file.id, file.version);
      await this.#sendFile(file);
    }
  }

  async #sendFile(file: LiveFile) {
    await this.#send({ t: 'file', id: file.id, version: file.version, type: file.type });
    const bytes = await file.read();
    for (let offset = 0; offset < bytes.length; offset += CHANNEL_BODY_CHUNK_BYTES) {
      const chunk = serializeBase64Url(bytes.slice(offset, offset + CHANNEL_BODY_CHUNK_BYTES));
      await this.#send({ t: 'body', id: file.id, chunk });
    }
    await this.#send({ t: 'end', id: file.id });
  }

  async end(reason: string) {
    if (this.#state.kind === 'closed') return;
    await this.#send({ t: 'closed', reason });
    this.#peer.close(NORMAL_CLOSE, reason);
    this.close();
  }

  fail(reason: string, error?: unknown) {
    if (this.#state.kind === 'closed') return;
    if (error) log.warn('[Share] Closing a share link', { reason, error: describeError(error) });
    this.#peer.close(POLICY_VIOLATION, reason);
    this.close();
  }

  close() {
    this.#state = { kind: 'closed' };
  }
}
