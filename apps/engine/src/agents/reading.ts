import { type ChatEntryOf, type ShinsaState, serializeTaskDetail } from '@shinsa/core';
import type { Transcripts } from './transcripts/index.ts';

const REPLIES_SHOWN = 3;

const REPLY_LIMIT = 1_500;

function listReplies(state: ShinsaState, transcripts: Transcripts, taskId: string) {
  return Object.values(state.runs)
    .filter((run) => run.taskId === taskId && !run.delegation)
    .sort((a, b) => a.startedAt - b.startedAt)
    .flatMap((run) =>
      transcripts
        .listEntries(run.id)
        .filter((entry): entry is ChatEntryOf<'agent'> => entry.type === 'agent' && entry.phase === 'final')
        .map((entry) => ({ role: run.role, text: entry.text }))
    )
    .slice(-REPLIES_SHOWN);
}

export function resolveTaskReading(state: ShinsaState, transcripts: Transcripts, taskId: string) {
  const detail = serializeTaskDetail(state, taskId);
  if (!state.tasks[taskId]) return detail;
  const replies = listReplies(state, transcripts, taskId);
  if (replies.length === 0) return detail;
  return [
    detail,
    'Latest agent replies:',
    ...replies.map(
      (reply) =>
        `- ${reply.role}: ${reply.text.length > REPLY_LIMIT ? `${reply.text.slice(0, REPLY_LIMIT)}…` : reply.text}`
    ),
  ].join('\n');
}
