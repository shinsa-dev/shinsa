import type { Evidence, EvidenceItemKind, FixReason } from './types.ts';

export interface EvidenceItem {
  id: string;
  key: string;
  kind: EvidenceItemKind;
  title: string;
  parts: Evidence[];
}

export type EvidenceUpdate = FixReason | 'work';

export interface CurrentEvidenceItem extends EvidenceItem {
  updated: EvidenceUpdate | null;
}

export interface EvidenceRemoval {
  at: number;
  reason: string;
}

export interface EarlierEvidenceItem extends EvidenceItem {
  removed: EvidenceRemoval | null;
}

const EVIDENCE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EVIDENCE_KEY_LIMIT = 60;

export function isEvidenceKey(key: string) {
  return key.length <= EVIDENCE_KEY_LIMIT && EVIDENCE_KEY.test(key);
}

function slugify(words: readonly (string | number | undefined)[]) {
  const slug = words
    .filter((word) => word !== undefined && word !== '')
    .join(' ')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, EVIDENCE_KEY_LIMIT)
    .replace(/^-+|-+$/g, '');
  return slug || 'evidence';
}

function isPartKind(evidence: Evidence) {
  return evidence.kind === 'screenshot' || evidence.kind === 'recording';
}

export function resolveEvidenceKey(evidence: Evidence) {
  if (evidence.key) return evidence.key;
  if (evidence.checkId) return slugify(['check', evidence.checkId]);
  const facts = [evidence.title, evidence.width, evidence.theme];
  return slugify(isPartKind(evidence) ? facts : [evidence.kind, ...facts]);
}

export function isCurrentEvidence(evidence: Evidence) {
  return !evidence.replacedBy && evidence.removedAt === undefined;
}

function resolveStageKey(evidence: Evidence) {
  return ['stage', evidence.round ?? 1, resolveEvidenceKey(evidence)].join('\u0000');
}

function resolvePartOrder(evidence: Evidence) {
  if (evidence.stage === 'before') return 0;
  return evidence.stage === 'after' ? 2 : 1;
}

function isStaged(evidence: Evidence) {
  return evidence.stage !== undefined && isPartKind(evidence);
}

function resolveItemKey(evidence: Evidence, joined: ReadonlyMap<string, string>) {
  if (evidence.itemId) return `item\u0000${evidence.itemId}`;
  if (!isStaged(evidence)) return `piece\u0000${evidence.id}`;
  const stageKey = resolveStageKey(evidence);
  return joined.get(stageKey) ?? stageKey;
}

function groupEvidenceItems(evidence: readonly Evidence[]): EvidenceItem[] {
  const joined = new Map<string, string>();
  for (const piece of evidence) {
    if (piece.itemId && isStaged(piece)) joined.set(resolveStageKey(piece), `item\u0000${piece.itemId}`);
  }
  const groups = new Map<string, { at: number; pieces: Evidence[] }>();
  for (let at = evidence.length - 1; at >= 0; at--) {
    const piece = evidence[at] as Evidence;
    const shared = resolveItemKey(piece, joined);
    const retaken =
      !piece.itemId &&
      groups.get(shared)?.pieces.some((part) => isStaged(part) && part.stage === piece.stage);
    const key = retaken ? `piece\u0000${piece.id}` : shared;
    const group = groups.get(key);
    groups.set(key, { at, pieces: [piece, ...(group?.pieces ?? [])] });
  }
  return [...groups.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ pieces }) => {
      const parts = [...pieces].sort((a, b) => resolvePartOrder(a) - resolvePartOrder(b));
      const [first] = pieces as [Evidence, ...Evidence[]];
      return {
        id: first.itemId ?? first.id,
        key: resolveEvidenceKey(first),
        kind: parts.length > 1 ? 'comparison' : first.kind,
        title: first.title,
        parts,
      };
    });
}

function resolveUpdate(item: EvidenceItem, evidence: readonly Evidence[]): EvidenceUpdate | null {
  const parts = new Map(item.parts.map((part) => [part.id, part]));
  const replacing = evidence
    .map((piece) => (piece.replacedBy ? parts.get(piece.replacedBy) : undefined))
    .find((part) => part !== undefined);
  if (!replacing) return null;
  return replacing.fixFor ?? 'work';
}

export function listEvidenceItems(evidence: readonly Evidence[]): CurrentEvidenceItem[] {
  return groupEvidenceItems(evidence.filter(isCurrentEvidence)).map((item) => ({
    ...item,
    updated: resolveUpdate(item, evidence),
  }));
}

function resolveRemoval(item: EvidenceItem): EvidenceRemoval | null {
  const removed = item.parts.find((part) => part.removedAt !== undefined);
  if (removed?.removedAt === undefined) return null;
  return { at: removed.removedAt, reason: removed.removedReason ?? '' };
}

export function listEarlierEvidenceItems(evidence: readonly Evidence[]): EarlierEvidenceItem[] {
  return groupEvidenceItems(evidence.filter((piece) => !isCurrentEvidence(piece))).map((item) => ({
    ...item,
    removed: resolveRemoval(item),
  }));
}

export function selectEvidenceItem<T extends EvidenceItem>(items: readonly T[], reference: string) {
  return (
    items.find(
      (item) =>
        item.id === reference || item.key === reference || item.parts.some((part) => part.id === reference)
    ) ?? null
  );
}
