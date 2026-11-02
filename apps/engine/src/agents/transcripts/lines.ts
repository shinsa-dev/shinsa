import { CHAT_PROTOCOL_VERSION, type ChatEntry, isChatEntry } from '@shinsa/core';
import { UNREADABLE_LINE } from './schema.ts';

function createUnreadableEntry(id: string): ChatEntry {
  return { v: CHAT_PROTOCOL_VERSION, id, at: 0, type: 'error', text: UNREADABLE_LINE };
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

export function parseLines(bytes: Buffer, offset: number): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let start = 0;
  while (start < bytes.length) {
    const newline = bytes.indexOf(0x0a, start);
    const end = newline < 0 ? bytes.length : newline;
    const line = bytes.toString('utf8', start, end);
    if (line.trim().length > 0) {
      const parsed = parseLine(line);
      entries.push(isChatEntry(parsed) ? parsed : createUnreadableEntry(`unreadable-${offset + start}`));
    }
    start = end + 1;
  }
  return entries;
}
