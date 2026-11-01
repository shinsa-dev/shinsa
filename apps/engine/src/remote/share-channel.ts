import {
  type Bytes,
  CHANNEL_BODY_CHUNK_BYTES,
  createFrameSealer,
  encodeText,
  REMOTE_KEY_ALGORITHM,
  type ShareFileType,
  type ShareLiveView,
  type ShareMessage,
  type ShareWelcome,
  serializeBase64Url,
  serializeShareMessage,
  type TeamListView,
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

export interface LiveShare<View = ShareLiveView | TeamListView> {
  view: View;
  files: LiveFile[];
}

interface ChannelGrant<Subject> {
  subject: Subject;
  welcome: ShareWelcome;
  session: CryptoKey;
}

export type HelloAnswer<Subject> = ChannelGrant<Subject> | { refused: string } | null;

export interface ShareChannelHost<Subject> {
  name: string;
  authorize: (hello: string) => Promise<HelloAnswer<Subject>>;
  resolveLive: (subject: Subject) => Promise<LiveShare>;
}

type ChannelState<Subject> =
  | { kind: 'hello' }
  | { kind: 'open'; subject: Subject; seal: (plain: Bytes) => Promise<Bytes> }
  | { kind: 'closed' };

function serializeViewKey(view: LiveShare['view']) {
  return JSON.stringify({ ...view, updatedAt: 0 });
}

export async function createChannelEphemeral() {
  return (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits'])) as CryptoKeyPair;
}

export class ShareChannel<Subject = string> {
  readonly #peer: ChannelPeer;
  readonly #host: ShareChannelHost<Subject>;
  readonly #sent = new Map<string, string>();
  #state: ChannelState<Subject> = { kind: 'hello' };
  #lastView: string | null = null;
  #queue: Promise<void> = Promise.resolve();
  #pushing = false;
  #dirty = false;

  constructor(peer: ChannelPeer, host: ShareChannelHost<Subject>) {
    this.#peer = peer;
    this.#host = host;
  }

  get subject() {
    return this.#state.kind === 'open' ? this.#state.subject : null;
  }

  receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    this.#queue = this.#queue.then(async () => {
      try {
        await this.#receive(raw);
      } catch (error) {
        this.fail(`The ${this.#host.name} broke.`, error);
      }
    });
    return this.#queue;
  }

  async #receive(raw: string | Bytes | ArrayBuffer | Uint8Array) {
    if (this.#state.kind === 'closed') return;
    if (this.#state.kind === 'open') {
      this.fail(`A ${this.#host.name} only listens.`);
      return;
    }
    const answer = typeof raw === 'string' && (await this.#host.authorize(raw));
    if (!answer) {
      this.fail(`The ${this.#host.name} expects a hello first.`);
      return;
    }
    if ('refused' in answer) {
      this.#refuse(answer.refused);
      return;
    }
    if (this.#state.kind !== 'hello') return;
    this.#state = { kind: 'open', subject: answer.subject, seal: createFrameSealer(answer.session) };
    this.#peer.send(JSON.stringify(answer.welcome));
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
        await this.#pushOnce(this.#state.subject);
      }
    } catch (error) {
      this.fail(`The ${this.#host.name} broke.`, error);
    } finally {
      this.#pushing = false;
    }
  }

  async #pushOnce(subject: Subject) {
    const live = await this.#host.resolveLive(subject);
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
    if (error) log.warn('[Share] Closing a live view', { reason, error: describeError(error) });
    this.#peer.close(POLICY_VIOLATION, reason);
    this.close();
  }

  close() {
    this.#state = { kind: 'closed' };
  }
}
