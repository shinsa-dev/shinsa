import { Effect, Schema } from 'effect';
import { EvidenceFolderInvalid, type EvidenceFolder, EvidenceSegment, RoundSegment } from './schema.ts';

const isSegment = Schema.is(EvidenceSegment);

const isRoundSegment = Schema.is(RoundSegment);

export const resolveFolderPath = Effect.fn('resolveFolderPath')(function* ({
  taskId,
  round,
}: EvidenceFolder) {
  if (!isSegment(taskId))
    return yield* new EvidenceFolderInvalid({ taskId, message: `${taskId} cannot name an evidence folder.` });
  return `${taskId}/round-${round}`;
});

export function isEvidencePath(segments: readonly string[]) {
  if (!segments.every(isSegment)) return false;
  return segments.length === 1 || (segments.length === 3 && isRoundSegment(segments[1] ?? ''));
}
