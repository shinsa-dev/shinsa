import { type ChatEntryOf, type RunRole, type ShinsaState, serializeTaskDetail } from '@shinsa/core';
import { Effect } from 'effect';
import type { Transcripts } from '../transcripts/service.ts';
import { REPLIES_SHOWN, REPLY_LIMIT, type TaskReply } from './schema.ts';

export const listTaskReplies = Effect.fn('TaskReading.listReplies')(function* (
  state: ShinsaState,
  transcripts: Transcripts['Service'],
  taskId: string,
  roles?: readonly RunRole[]
) {
  const runs = Object.values(state.runs)
    .filter((run) => run.taskId === taskId && !run.delegation && (!roles || roles.includes(run.role)))
    .sort((a, b) => a.startedAt - b.startedAt);
  const replies = yield* Effect.forEach(runs, (run) =>
    Effect.map(transcripts.listEntries(run.id), (entries) =>
      entries
        .filter((entry): entry is ChatEntryOf<'agent'> => entry.type === 'agent' && entry.phase === 'final')
        .map((entry): TaskReply => ({ at: entry.at, role: run.role, text: entry.text }))
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
  const replies = yield* listTaskReplies(state, transcripts, taskId);
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
