import type { DiffFile } from '@shinsa/core';

export interface DiffLines {
  start: number;
  end: number;
}

export type DiffSource =
  | { kind: 'files'; path: string; before: string | null; after: string | null }
  | { kind: 'patch'; path: string; previousPath: string | null; hunks: string; binary: boolean };

export interface DiffHunkRows {
  unifiedLineCount: number;
  collapsedBefore: number;
}

export const DIFF_ROW_HEIGHT = 18;

const VISIBLE_ROWS = 14;

const SPARE_ROWS = 2;

const SPOT_CONTEXT = 2;

const CONTEXT_PATCH_LINES = 14;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface PatchLine {
  text: string;
  oldLine: number;
  newLine: number;
}

function splitContent(content: string) {
  return content.replace(/\n$/, '').split('\n');
}

function listHunks(patch: string) {
  const hunks: { oldStart: number; newStart: number; body: string[] }[] = [];
  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header) hunks.push({ oldStart: Number(header[1]), newStart: Number(header[3]), body: [] });
    else if (/^[ +-]/.test(line)) hunks.at(-1)?.body.push(line);
  }
  return hunks;
}

function listPatchLines(hunk: { oldStart: number; newStart: number; body: string[] }) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.body.map((text): PatchLine => {
    const line = { text, oldLine, newLine };
    if (!text.startsWith('+')) oldLine += 1;
    if (!text.startsWith('-')) newLine += 1;
    return line;
  });
}

function serializeHunk(lines: PatchLine[]) {
  const first = lines[0] as PatchLine;
  const oldCount = lines.filter((line) => !line.text.startsWith('+')).length;
  const newCount = lines.filter((line) => !line.text.startsWith('-')).length;
  const oldStart = oldCount === 0 ? Math.max(0, first.oldLine - 1) : first.oldLine;
  const newStart = newCount === 0 ? Math.max(0, first.newLine - 1) : first.newLine;
  return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...lines.map((line) => line.text)].join(
    '\n'
  );
}

export function hasHunks(hunks: string) {
  return listHunks(hunks).some((hunk) => hunk.body.length > 0);
}

export function narrowHunks(patch: string, lines: DiffLines) {
  const from = lines.start - SPOT_CONTEXT;
  const to = lines.end + SPOT_CONTEXT;
  const kept = listHunks(patch)
    .map((hunk) => listPatchLines(hunk).filter((line) => line.newLine >= from && line.newLine <= to))
    .filter((hunk) => hunk.some((line) => !line.text.startsWith(' ')))
    .map(serializeHunk);
  return kept.length > 0 ? kept.join('\n') : null;
}

export function createContextHunk(content: string, lines: DiffLines) {
  const all = splitContent(content);
  const first = Math.max(1, Math.min(lines.start, all.length) - SPOT_CONTEXT);
  const last = Math.min(all.length, lines.end + SPOT_CONTEXT, first + CONTEXT_PATCH_LINES - 1);
  const shown = all.slice(first - 1, last);
  return [
    `@@ -${first},${shown.length} +${first},${shown.length} @@`,
    ...shown.map((line) => ` ${line}`),
  ].join('\n');
}

export function resolveSpotSource(
  path: string,
  file: DiffFile | null,
  content: string | null,
  lines: DiffLines
): DiffSource | null {
  const previousPath = file?.previousPath ?? null;
  if (file?.binary) return { kind: 'patch', path, previousPath, hunks: '', binary: true };
  const changed = file ? narrowHunks(file.patch, lines) : null;
  if (changed) return { kind: 'patch', path, previousPath, hunks: changed, binary: false };
  if (content === null || content === '') return null;
  return { kind: 'patch', path, previousPath: null, hunks: createContextHunk(content, lines), binary: false };
}

export function terminateText(text: string | null) {
  if (text === null || text === '' || text.endsWith('\n')) return text;
  return `${text}\n`;
}

export function serializePatch(source: Extract<DiffSource, { kind: 'patch' }>) {
  return `--- ${source.previousPath ?? source.path}\n+++ ${source.path}\n${source.hunks}\n`;
}

export function hasDiffBody(source: DiffSource) {
  if (source.kind === 'patch') return !source.binary && hasHunks(source.hunks);
  return source.before !== source.after;
}

export function resolveDiffNote(source: DiffSource) {
  if (source.kind === 'files') return source.before === source.after ? 'No line changed.' : null;
  if (source.binary) return 'A binary file, not shown as text.';
  if (source.previousPath === null || source.previousPath === source.path) return null;
  if (!hasHunks(source.hunks)) return `Renamed from ${source.previousPath}, with no line changed.`;
  return `Renamed from ${source.previousPath}.`;
}

export function countDiffRows(hunks: DiffHunkRows[]) {
  return hunks.reduce(
    (total, hunk, index) => total + hunk.unifiedLineCount + (hunk.collapsedBefore > 0 && index > 0 ? 1 : 0),
    0
  );
}

export function resolveDiffClamp(rows: number, expanded: boolean) {
  if (expanded || rows <= VISIBLE_ROWS + SPARE_ROWS) return { maxHeight: null, hidden: 0 };
  return { maxHeight: VISIBLE_ROWS * DIFF_ROW_HEIGHT, hidden: rows - VISIBLE_ROWS };
}
