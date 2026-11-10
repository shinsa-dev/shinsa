import { CHAT_PROTOCOL_VERSION, type ChatEntry, isChatEntry } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { NEWLINE } from '../../files/schema.ts';
import { UNREADABLE_LINE } from './schema.ts';

const decodeLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function createUnreadableEntry(id: string): ChatEntry {
  return { v: CHAT_PROTOCOL_VERSION, id, at: 0, type: 'error', text: UNREADABLE_LINE };
}

export function parseLines(bytes: Buffer, offset: number): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(NEWLINE, start);
    const end = newline < 0 ? bytes.length : newline;
    const line = bytes.toString('utf8', start, end);
    if (line.trim().length > 0) {
      const parsed = Option.getOrNull(decodeLine(line));
      entries.push(isChatEntry(parsed) ? parsed : createUnreadableEntry(`unreadable-${offset + start}`));
    }
    start = end + 1;
  }
  return entries;
}
