import { type ChatEntry, type ShinsaState, splitMessageAttachments } from '@shinsa/core';
import { ATTACHMENT_ROUTE } from '../store/attachments.ts';
import { EVIDENCE_ROUTE } from '../store/evidence.ts';

export interface RunEntryReader {
  listEntries(runId: string): ChatEntry[];
}

const TASK_READS = /^\/api\/tasks\/([^/]+)(?:\/(?:blob|chat|diff|paths|raw|refs|search|tree))?$/;

function listTaskTexts(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  return [task?.request ?? '', ...(task?.inbox ?? []).map((message) => message.text)];
}

function listEntryFiles(entry: ChatEntry) {
  if (entry.type === 'tool_result') return entry.images;
  if (entry.type === 'user') return entry.attachments.map((attachment) => attachment.url);
  return [];
}

function isTaskFile(state: ShinsaState, taskId: string, path: string, transcripts: RunEntryReader) {
  if (path.startsWith(`${EVIDENCE_ROUTE}${taskId}/`)) return true;
  const evidence = Object.values(state.evidence);
  if (evidence.some((entry) => entry.taskId === taskId && entry.uri === path)) return true;
  const texts = listTaskTexts(state, taskId);
  const attached = texts.flatMap((text) => splitMessageAttachments(text).attachments);
  if (attached.some((attachment) => attachment.url === path)) return true;
  const runs = Object.values(state.runs).filter((run) => run.taskId === taskId);
  return runs.some((run) =>
    transcripts.listEntries(run.id).some((entry) => listEntryFiles(entry).includes(path))
  );
}

export function isGuestRoute(
  state: ShinsaState,
  taskId: string,
  method: string,
  pathname: string,
  transcripts: RunEntryReader
) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname === '/api/health') return true;
  const task = TASK_READS.exec(pathname);
  if (task) return decodeURIComponent(task[1] ?? '') === taskId;
  if (!(pathname.startsWith(EVIDENCE_ROUTE) || pathname.startsWith(ATTACHMENT_ROUTE))) return false;
  return isTaskFile(state, taskId, pathname, transcripts);
}
