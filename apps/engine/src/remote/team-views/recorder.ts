import type { ShareLiveView, ShareMessage } from '@shinsa/core';
import { Option, Schema } from 'effect';
import {
  LiveViewText,
  type ReceivingViewFile,
  type StoredViewFile,
  TEAM_VIEW_FILES_LIMIT,
} from './schema.ts';

const decodeLiveView = Schema.decodeUnknownOption(LiveViewText);

export class TeamViewRecorder {
  readonly #limit: number;
  #view: ShareMessage | null = null;
  #listed: ShareLiveView['files'] = {};
  #updatedAt: number | null = null;
  readonly #stored = new Map<string, StoredViewFile>();
  readonly #settled = new Set<string>();
  readonly #receiving = new Map<string, ReceivingViewFile>();

  constructor(limit = TEAM_VIEW_FILES_LIMIT) {
    this.#limit = limit;
  }

  get updatedAt() {
    return this.#updatedAt;
  }

  get isComplete() {
    return this.#view !== null && Object.keys(this.#listed).every((id) => this.#settled.has(id));
  }

  receive(message: ShareMessage) {
    switch (message.t) {
      case 'view':
        return this.#receiveView(message);
      case 'file':
        this.#receiving.set(message.id, {
          version: message.version,
          messages: [message],
          size: 0,
          dropped: false,
        });
        return false;
      case 'body': {
        const file = this.#receiving.get(message.id);
        if (!file || file.dropped) return false;
        file.size += message.chunk.length;
        if (this.#storedSize() + file.size > this.#limit) file.dropped = true;
        else file.messages.push(message);
        return false;
      }
      case 'end':
        return this.#receiveEnd(message.id, message);
      default:
        return false;
    }
  }

  #receiveView(message: Extract<ShareMessage, { t: 'view' }>) {
    const view = Option.getOrNull(decodeLiveView(message.data));
    if (!view) return false;
    this.#view = message;
    this.#listed = view.files as ShareLiveView['files'];
    this.#updatedAt = view.shared.task.updatedAt;
    for (const [id, file] of this.#stored) {
      if (this.#listed[id]?.version === file.version) continue;
      this.#stored.delete(id);
      this.#settled.delete(id);
    }
    return true;
  }

  #receiveEnd(id: string, message: ShareMessage) {
    const file = this.#receiving.get(id);
    this.#receiving.delete(id);
    if (!file) return false;
    this.#settled.add(id);
    if (file.dropped) return false;
    this.#stored.set(id, { version: file.version, messages: [...file.messages, message], size: file.size });
    return true;
  }

  #storedSize() {
    let size = 0;
    for (const file of this.#stored.values()) size += file.size;
    return size;
  }

  messages(): ShareMessage[] {
    if (!this.#view) return [];
    return [this.#view, ...[...this.#stored.values()].flatMap((file) => file.messages)];
  }
}
