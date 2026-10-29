import {
  type EarlierEvidenceItem,
  type Evidence,
  type EvidenceItem,
  type EvidenceItemKind,
  type EvidenceUpdate,
  isCurrentEvidence,
  listEarlierEvidenceItems,
  listEvidenceItems,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import type { ViewerImage } from '@/hooks/use-image-viewer.ts';
import { type EvidenceMedia, listRoundEvidence, resolveEvidenceMedia } from '@/lib/evidence/media.ts';

export interface EvidenceView {
  evidence: Evidence;
  media: EvidenceMedia;
  facts: string;
  fromReview: boolean;
  updated: string | null;
  image: number | null;
}

export interface EvidenceCheck {
  id: string;
  taskId: string;
  links: Evidence[];
  output: EvidenceView | null;
}

export interface EvidenceEntry {
  key: string;
  kind: EvidenceItemKind;
  title: string;
  facts: string;
  detail: string | null;
  fromReview: boolean;
  updated: string | null;
  parts: EvidenceView[];
  check?: EvidenceCheck;
}

export interface EarlierEvidenceEntry extends EvidenceEntry {
  status: string;
}

export interface EvidenceGroup {
  kind: EvidenceItemKind;
  label: string;
  entries: EvidenceEntry[];
}

export interface EvidenceLayout {
  count: number;
  groups: EvidenceGroup[];
  earlier: EarlierEvidenceEntry[];
  images: ViewerImage[];
  folder: string | null;
}

const STAGE_LABEL = { before: 'Before', after: 'After' } as const;

const THEME_LABEL = { light: 'Light', dark: 'Dark' } as const;

const KIND_ORDER: readonly EvidenceItemKind[] = [
  'comparison',
  'recording',
  'screenshot',
  'test',
  'check',
  'note',
  'preview',
];

const KIND_NAME: Record<EvidenceItemKind, readonly [string, string]> = {
  comparison: ['comparison', 'comparisons'],
  screenshot: ['screenshot', 'screenshots'],
  recording: ['recording', 'recordings'],
  test: ['test', 'tests'],
  check: ['check', 'checks'],
  note: ['note', 'notes'],
  preview: ['preview', 'previews'],
};

const STORED = '/api/evidence/';

const EARLIER = 'earlier:';

export function listShownEvidenceImages(layout: EvidenceLayout, earlierOpen: boolean) {
  return earlierOpen ? layout.images : layout.images.filter((image) => !image.item?.startsWith(EARLIER));
}

const UPDATE_TEXT: Partial<Record<EvidenceUpdate, string>> = {
  you: 'Updated after your review',
  review: 'Updated after the agent review',
  checks: 'Updated after the checks',
  pull_request: 'Updated after the pull request feedback',
};

export function describeEvidenceUpdate(update: EvidenceUpdate | null) {
  if (update === null) return null;
  return UPDATE_TEXT[update] ?? 'Updated';
}

function describeEarlierStatus(item: EarlierEvidenceItem) {
  return item.removed ? `Removed: ${item.removed.reason}` : 'Replaced by a later version';
}

function upperFirst(text: string) {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function resolveKindName(kind: EvidenceItemKind, count: number) {
  const [one, many] = KIND_NAME[kind];
  return count === 1 ? one : many;
}

export function describeEvidenceFacts(evidence: Pick<Evidence, 'width' | 'theme'>) {
  return [evidence.width ? `${evidence.width}px` : null, evidence.theme ? THEME_LABEL[evidence.theme] : null]
    .filter(Boolean)
    .join(' · ');
}

export function describeEvidenceStage(evidence: Evidence) {
  return evidence.stage ? STAGE_LABEL[evidence.stage] : null;
}

export function describeEvidencePart(evidence: Evidence) {
  return evidence.label ?? describeEvidenceStage(evidence) ?? evidence.title;
}

export function describeEvidenceKind(kind: EvidenceItemKind, count = 1) {
  return upperFirst(resolveKindName(kind, count));
}

function joinList(items: readonly string[]) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

interface CheckPieces {
  id: string;
  taskId: string;
  pieces: Evidence[];
}

function splitCheckEvidence(evidence: readonly Evidence[]) {
  const checks = new Map<string, CheckPieces>();
  const others: Evidence[] = [];
  for (const piece of evidence) {
    if (!piece.checkId) {
      others.push(piece);
      continue;
    }
    const group = checks.get(piece.checkId) ?? { id: piece.checkId, taskId: piece.taskId, pieces: [] };
    group.pieces.push(piece);
    checks.set(piece.checkId, group);
  }
  return { others, checks: [...checks.values()] };
}

function resolveCheckKind(pieces: readonly Evidence[]): EvidenceItemKind {
  return pieces.some((piece) => piece.kind === 'test') ? 'test' : 'check';
}

function listItemKinds(evidence: readonly Evidence[]) {
  const { others, checks } = splitCheckEvidence(evidence.filter(isCurrentEvidence));
  return [
    ...listEvidenceItems(others).map((item) => item.kind),
    ...checks.map((check) => resolveCheckKind(check.pieces)),
  ];
}

export function describeEvidenceSummary(evidence: readonly Evidence[]) {
  const counts = new Map<EvidenceItemKind, number>();
  for (const kind of listItemKinds(evidence)) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const phrases = KIND_ORDER.flatMap((kind) => {
    const count = counts.get(kind);
    return count ? [`${count} ${resolveKindName(kind, count)}`] : [];
  });
  return upperFirst(joinList(phrases));
}

export function describeEvidenceCaption(entry: Pick<EvidenceEntry, 'title' | 'facts'>) {
  return [entry.title, entry.facts].filter(Boolean).join(' · ');
}

function resolveSharedFacts(parts: readonly EvidenceView[]) {
  const [first] = parts;
  if (!first) return '';
  const themes = new Set(parts.map((part) => part.evidence.theme));
  return themes.size === 1
    ? first.facts
    : describeEvidenceFacts({ width: first.evidence.width, theme: undefined });
}

function resolveSharedDetail(parts: readonly EvidenceView[]) {
  const details = new Set(parts.map((part) => part.evidence.detail ?? null));
  return details.size === 1 ? ([...details][0] ?? null) : null;
}

export function isVisualEvidence(view: EvidenceView) {
  return view.media === 'image' || view.media === 'video';
}

function numberImages(entries: readonly EvidenceEntry[]) {
  const images: ViewerImage[] = [];
  for (const entry of entries) {
    const caption = describeEvidenceCaption(entry);
    const named = entry.kind === 'comparison';
    for (const part of entry.parts.filter(isVisualEvidence)) {
      part.image = images.length;
      images.push({
        src: part.evidence.uri,
        caption,
        media: part.media === 'video' ? 'video' : 'image',
        width: part.evidence.width ?? null,
        item: entry.key,
        ...(named ? { part: describeEvidencePart(part.evidence) } : {}),
      });
    }
  }
  return images;
}

export function resolveEvidenceFolder(dataDir: string | null | undefined, evidence: readonly Evidence[]) {
  const stored = evidence.find((item) => item.uri.startsWith(STORED) && item.uri.split('/').length > 4);
  if (!dataDir || !stored) return null;
  const relative = stored.uri.slice(STORED.length).split('/').slice(0, -1).join('/');
  return `${dataDir.replace(/\/+$/, '')}/evidence/${relative}`;
}

export function shortenHomePath(path: string) {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~');
}

export function resolveEvidenceLayout(
  state: Pick<ShinsaState, 'evidence' | 'runs'>,
  task: Task,
  dataDir: string | null = null
): EvidenceLayout {
  return resolveEvidenceListLayout(listRoundEvidence(state.evidence, task), state.runs, dataDir);
}

function resolveCheckEntry(check: CheckPieces, resolveView: (item: Evidence) => EvidenceView): EvidenceEntry {
  const links = check.pieces
    .filter((piece) => piece.runId !== null && isCurrentEvidence(piece))
    .map(resolveView);
  const outputs = check.pieces.filter((piece) => piece.runId === null);
  const latest = outputs.reduce<Evidence | null>(
    (found, piece) => (found && found.attachedAt > piece.attachedAt ? found : piece),
    null
  );
  const output = latest ? resolveView(latest) : null;
  const first = links[0] ?? output;
  return {
    key: `check:${check.id}`,
    kind: resolveCheckKind(check.pieces),
    title: first?.evidence.title ?? check.id,
    facts: '',
    detail: links.find((link) => link.evidence.detail)?.evidence.detail ?? null,
    fromReview: links.some((link) => link.fromReview),
    updated: null,
    parts: output ? [output] : [],
    check: { id: check.id, taskId: check.taskId, links: links.map((link) => link.evidence), output },
  };
}

export function resolveEvidenceListLayout(
  evidence: readonly Evidence[],
  runs: ShinsaState['runs'],
  dataDir: string | null = null
): EvidenceLayout {
  const resolveView = (item: Evidence, updated: string | null = null): EvidenceView => ({
    evidence: item,
    media: resolveEvidenceMedia(item.uri, item.kind),
    facts: describeEvidenceFacts(item),
    fromReview: item.runId !== null && runs[item.runId]?.role === 'reviewer',
    updated,
    image: null,
  });
  const resolveEntry = (item: EvidenceItem, updated: string | null): EvidenceEntry => {
    const parts = item.parts.map((part) => resolveView(part, updated));
    return {
      key: item.id,
      kind: item.kind,
      title: item.title,
      facts: resolveSharedFacts(parts),
      detail: resolveSharedDetail(parts),
      fromReview: parts.some((part) => part.fromReview),
      updated,
      parts,
    };
  };
  const { others, checks } = splitCheckEvidence(evidence);
  const items = listEvidenceItems(others).map((item) =>
    resolveEntry(item, describeEvidenceUpdate(item.updated))
  );
  const entries = [...items, ...checks.map((check) => resolveCheckEntry(check, resolveView))];
  const groups = KIND_ORDER.flatMap((kind) => {
    const members = entries.filter((entry) => entry.kind === kind);
    if (members.length === 0) return [];
    return [{ kind, label: describeEvidenceKind(kind, members.length), entries: members }];
  });
  const earlier = listEarlierEvidenceItems(others).map(
    (item): EarlierEvidenceEntry => ({
      ...resolveEntry(item, null),
      key: `${EARLIER}${item.id}`,
      status: describeEarlierStatus(item),
    })
  );
  return {
    count: entries.length,
    groups,
    earlier,
    images: numberImages([...groups.flatMap((group) => group.entries), ...earlier]),
    folder: resolveEvidenceFolder(dataDir, evidence),
  };
}

export function listEvidencePrefetch(layout: EvidenceLayout) {
  const parts = layout.groups.flatMap((group) => group.entries.flatMap((entry) => entry.parts));
  return {
    images: parts.filter((view) => view.media === 'image').map((view) => view.evidence.uri),
    texts: parts.filter((view) => view.media === 'text').map((view) => view.evidence.uri),
  };
}
