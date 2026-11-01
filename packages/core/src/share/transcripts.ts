import type { ChatEntry, ChatNotice, ChatTool } from '../chat/protocol.ts';
import type { ShinsaToolName } from '../domain/tools.ts';

export const SHARE_TRANSCRIPT_PREFIX = 'transcript-';

export const SHARE_TRANSCRIPT_PAGE = 200;

const PRIVATE_SHINSA_TOOLS: ReadonlySet<ShinsaToolName> = new Set<ShinsaToolName>([
  'ask',
  'request_secret',
  'delegate_task',
  'delegation_answer',
]);

const SHARED_NOTICES: ReadonlySet<ChatNotice['kind']> = new Set<ChatNotice['kind']>([
  'interrupted',
  'compaction',
  'context',
  'delegation',
]);

export function resolveShareTranscriptFile(runId: string, page: number) {
  return `${SHARE_TRANSCRIPT_PREFIX}${runId}-${page}`;
}

export function countShareTranscriptPages(entries: number) {
  return Math.ceil(entries / SHARE_TRANSCRIPT_PAGE);
}

function isPrivateTool(tool: ChatTool) {
  return tool.kind === 'shinsa' && PRIVATE_SHINSA_TOOLS.has(tool.name);
}

function redactTool(tool: ChatTool): ChatTool {
  return tool.kind === 'task' ? { ...tool, prompt: null } : tool;
}

function redactNotice(notice: ChatNotice): ChatNotice {
  return notice.kind === 'compaction' ? { ...notice, summary: null } : notice;
}

function redactEntry(entry: ChatEntry, privateCalls: Set<string>, messages: boolean): ChatEntry | null {
  switch (entry.type) {
    case 'user':
      return messages && entry.from === 'you' ? { ...entry, attachments: [] } : null;
    case 'tool_call':
      if (!isPrivateTool(entry.tool)) return { ...entry, tool: redactTool(entry.tool) };
      privateCalls.add(entry.callId);
      return null;
    case 'tool_result':
      return privateCalls.has(entry.callId) ? null : { ...entry, images: [] };
    case 'notice':
      return SHARED_NOTICES.has(entry.notice.kind) ? { ...entry, notice: redactNotice(entry.notice) } : null;
    case 'agent':
    case 'status':
    case 'error':
      return entry;
  }
}

export function redactTranscript(entries: readonly ChatEntry[], from = 0, messages = false): ChatEntry[] {
  const privateCalls = new Set<string>();
  return entries.flatMap((entry, index) => {
    const redacted = redactEntry(entry, privateCalls, messages);
    return redacted && index >= from ? [redacted] : [];
  });
}

export function redactTranscriptPage(entries: readonly ChatEntry[], page: number, messages = false) {
  const end = (page + 1) * SHARE_TRANSCRIPT_PAGE;
  return redactTranscript(entries.slice(0, end), page * SHARE_TRANSCRIPT_PAGE, messages);
}
