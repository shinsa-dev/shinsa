import { Option, Schema } from 'effect';
import { MINUTE } from '../kit/time.ts';

const TranscriptLine = Schema.fromJsonString(
  Schema.StructWithRest(Schema.Struct({ id: Schema.String, at: Schema.Number }), [
    Schema.Record(Schema.String, Schema.Unknown),
  ])
);

const decodeTranscriptLine = Schema.decodeUnknownOption(TranscriptLine);

export function insertNotices(transcript: string, notices: readonly object[], now: number) {
  return Option.map(
    Option.all(
      transcript
        .trim()
        .split('\n')
        .map((line) => decodeTranscriptLine(line))
    ),
    (entries) => {
      const brief = entries[1] ?? entries[0];
      const at = brief?.at ?? now;
      const inserted = notices.map((notice, index) => ({
        ...brief,
        id: `task-account-move-run-1-notice-${index}`,
        at: at + index + 1,
        type: 'notice',
        notice,
      }));
      const context = {
        ...brief,
        id: 'task-account-move-run-1-context',
        at: now - MINUTE,
        type: 'notice',
        notice: { kind: 'context', usedTokens: 132_000, maxTokens: 200_000, totalProcessedTokens: 910_000 },
      };
      const lines = [...entries.slice(0, 2), ...inserted, ...entries.slice(2), context];
      return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
    }
  );
}
