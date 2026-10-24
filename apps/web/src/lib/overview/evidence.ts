import { type Evidence, resolveCurrentRound, type ShinsaState, type Task } from '@shinsa/core';

export type EvidenceKind = 'image' | 'video' | 'text' | 'file' | 'link';

const IMAGE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;

const VIDEO = /\.(mp4|webm|mov)(\?.*)?$/i;

const TEXT = /\.(txt|log|md)(\?.*)?$/i;

const STORED = '/api/evidence/';

export function resolveEvidenceKind(uri: string): EvidenceKind {
  if (!uri.startsWith(STORED)) return 'link';
  if (IMAGE.test(uri)) return 'image';
  if (VIDEO.test(uri)) return 'video';
  return TEXT.test(uri) ? 'text' : 'file';
}

export function isVisualEvidence(uri: string) {
  const kind = resolveEvidenceKind(uri);
  return kind === 'image' || kind === 'video';
}

export function listRoundEvidence(evidence: ShinsaState['evidence'], task: Task): Evidence[] {
  const round = resolveCurrentRound(task).number;
  return Object.values(evidence)
    .filter((item) => item.taskId === task.id && (item.round ?? 1) === round)
    .sort((a, b) => a.attachedAt - b.attachedAt);
}
