import { type Evidence, resolveCurrentRound, type ShinsaState, type Task } from '@shinsa/core';

export type EvidenceMedia = 'image' | 'video' | 'text' | 'file' | 'link';

const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;

const VIDEO = /\.(mp4|webm|mov)(\?.*)?$/i;

const TEXT = /\.(txt|log|md)(\?.*)?$/i;

const SERVED = /^\/(?!\/)/;

const WEB = /^https?:\/\//i;

const LINKED_MEDIA: Partial<Record<Evidence['kind'], EvidenceMedia>> = {
  screenshot: 'image',
  recording: 'video',
};

export function resolveEvidenceMedia(uri: string, kind?: Evidence['kind']): EvidenceMedia {
  const linked = kind && WEB.test(uri) ? LINKED_MEDIA[kind] : undefined;
  if (linked) return linked;
  if (!SERVED.test(uri)) return 'link';
  if (IMAGE.test(uri)) return 'image';
  if (VIDEO.test(uri)) return 'video';
  return TEXT.test(uri) ? 'text' : 'file';
}

export function listRoundEvidence(evidence: ShinsaState['evidence'], task: Task): Evidence[] {
  const round = resolveCurrentRound(task).number;
  return Object.values(evidence)
    .filter((item) => item.taskId === task.id && (item.round ?? 1) === round)
    .sort((a, b) => a.attachedAt - b.attachedAt);
}
