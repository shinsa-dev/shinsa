import type { Evidence, EvidenceItemKind } from './types.ts';

export interface EvidenceItem {
  id: string;
  kind: EvidenceItemKind;
  title: string;
  parts: Evidence[];
}

function isPartKind(evidence: Evidence) {
  return evidence.kind === 'screenshot' || evidence.kind === 'recording';
}

function resolveStageKey(evidence: Evidence) {
  return ['stage', evidence.round ?? 1, evidence.title, evidence.width ?? '', evidence.theme ?? ''].join(
    '\u0000'
  );
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

export function listEvidenceItems(evidence: readonly Evidence[]): EvidenceItem[] {
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
        kind: parts.length > 1 ? 'comparison' : first.kind,
        title: first.title,
        parts,
      };
    });
}
