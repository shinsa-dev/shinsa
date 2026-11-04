import type { ShareLiveView, ShareMessage } from '@shinsa/core';
import { Option, Schema } from 'effect';
import {
  LiveViewText,
  type ReceivingViewFile,
  type StoredViewFile,
  TEAM_VIEW_FILES_LIMIT,
} from './schema.ts';

const decodeLiveView = Schema.decodeUnknownOption(LiveViewText);

export type TeamViewRecorder = ReturnType<typeof createTeamViewRecorder>;

export function createTeamViewRecorder(limit = TEAM_VIEW_FILES_LIMIT) {
  let view: ShareMessage | null = null;
  let listed: ShareLiveView['files'] = {};
  let updatedAt: number | null = null;
  const stored = new Map<string, StoredViewFile>();
  const settled = new Set<string>();
  const receiving = new Map<string, ReceivingViewFile>();

  const countStored = () => {
    let size = 0;
    for (const file of stored.values()) size += file.size;
    return size;
  };

  const receiveView = (message: Extract<ShareMessage, { t: 'view' }>) => {
    const decoded = Option.getOrNull(decodeLiveView(message.data));
    if (!decoded) return false;
    view = message;
    listed = decoded.files as ShareLiveView['files'];
    updatedAt = decoded.shared.task.updatedAt;
    for (const [id, file] of stored) {
      if (listed[id]?.version === file.version) continue;
      stored.delete(id);
      settled.delete(id);
    }
    return true;
  };

  const receiveEnd = (id: string, message: ShareMessage) => {
    const file = receiving.get(id);
    receiving.delete(id);
    if (!file) return false;
    settled.add(id);
    if (file.dropped) return false;
    stored.set(id, { version: file.version, messages: [...file.messages, message], size: file.size });
    return true;
  };

  return {
    get updatedAt() {
      return updatedAt;
    },
    get isComplete() {
      return view !== null && Object.keys(listed).every((id) => settled.has(id));
    },
    receive(message: ShareMessage) {
      switch (message.t) {
        case 'view':
          return receiveView(message);
        case 'file':
          receiving.set(message.id, {
            version: message.version,
            messages: [message],
            size: 0,
            dropped: false,
          });
          return false;
        case 'body': {
          const file = receiving.get(message.id);
          if (!file || file.dropped) return false;
          file.size += message.chunk.length;
          if (countStored() + file.size > limit) file.dropped = true;
          else file.messages.push(message);
          return false;
        }
        case 'end':
          return receiveEnd(message.id, message);
        default:
          return false;
      }
    },
    messages(): ShareMessage[] {
      if (!view) return [];
      return [view, ...[...stored.values()].flatMap((file) => file.messages)];
    },
  };
}
