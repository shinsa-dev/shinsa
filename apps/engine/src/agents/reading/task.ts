import { type ChatEntryOf, type ShinsaState, serializeTaskDetail } from '@shinsa/core';
import { Effect } from 'effect';
import type { Transcripts } from '../transcripts/service.ts';
import { REPLIES_SHOWN, REPLY_LIMIT } from './schema.ts';

const listReplies = Effect.fn('TaskReading.listReplies')(function* (
  state: ShinsaState,
  transcripts: Transcripts['Service'],
  taskId: string
) {
  const runs = Object.values(state.runs)
    .filter((run) => run.taskId === taskId && !run.delegation)
    .sort((a, b) => a.startedAt - b.startedAt);
  const replies = yield* Effect.forEach(runs, (run) =>
    Effect.map(transcripts.listEntries(run.id), (entries) =>
      entries
        .filter((entry): entry is ChatEntryOf<'agent'> => entry.type === 'agent' && entry.phase === 'final')
        .map((entry) => ({ role: run.role, text: entry.text }))
    )
  );
  return replies.flat().slice(-REPLIES_SHOWN);
});

export const resolveTaskReading = Effect.fn('TaskReading.resolve')(function* (
  state: ShinsaState,
  transcripts: Transcripts['Service'],
  taskId: string
) {
  const detail = serializeTaskDetail(state, taskId);
  if (!state.tasks[taskId]) return detail;
  const replies = yield* listReplies(state, transcripts, taskId);
  if (replies.length === 0) return detail;
  return [
    detail,
    'Latest agent replies:',
    ...replies.map(
      (reply) =>
        `- ${reply.role}: ${reply.text.length > REPLY_LIMIT ? `${reply.text.slice(0, REPLY_LIMIT)}…` : reply.text}`
    ),
  ].join('\n');
});
