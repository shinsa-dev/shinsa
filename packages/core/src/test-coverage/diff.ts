import type { ChangedLines } from './types.ts';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

const QUOTE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', '"': '"', '\\': '\\' };

function unquotePath(text: string) {
  if (!(text.startsWith('"') && text.endsWith('"') && text.length >= 2)) return text;
  const bytes: number[] = [];
  const inner = text.slice(1, -1);
  const encoder = new TextEncoder();
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index] ?? '';
    if (char !== '\\') {
      bytes.push(...encoder.encode(char));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(inner.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
      continue;
    }
    const next = inner[index + 1] ?? '';
    bytes.push(...encoder.encode(QUOTE_ESCAPES[next] ?? next));
    index += 1;
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function parseHeaderPath(header: string, prefix: string) {
  const value = unquotePath(header.slice(4).split('\t')[0] ?? '');
  if (value === '/dev/null') return null;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newCount: number;
}

interface DiffFileLines {
  oldPath: string | null;
  path: string | null;
  hunks: DiffHunk[];
  added: number[];
}

interface DiffCursor {
  file: DiffFileLines | null;
  oldLeft: number;
  newLeft: number;
  next: number;
}

function readHunkLine(cursor: DiffCursor, line: string) {
  const mark = line.charAt(0);
  if (mark === '-') {
    cursor.oldLeft -= 1;
    return;
  }
  if (mark !== '+' && mark !== ' ') return;
  if (mark === '+') cursor.file?.added.push(cursor.next);
  if (mark === ' ') cursor.oldLeft -= 1;
  cursor.next += 1;
  cursor.newLeft -= 1;
}

function startFile(cursor: DiffCursor, files: DiffFileLines[]) {
  const file: DiffFileLines = { oldPath: null, path: null, hunks: [], added: [] };
  files.push(file);
  cursor.file = file;
  return file;
}

function readHeaderLine(cursor: DiffCursor, line: string, files: DiffFileLines[]) {
  if (line.startsWith('diff --git ')) {
    startFile(cursor, files);
    return;
  }
  if (line.startsWith('--- ')) {
    const file = cursor.file && cursor.file.hunks.length === 0 ? cursor.file : startFile(cursor, files);
    file.oldPath = parseHeaderPath(line, 'a/');
    return;
  }
  if (line.startsWith('+++ ')) {
    const file = cursor.file ?? startFile(cursor, files);
    file.path = parseHeaderPath(line, 'b/');
    return;
  }
  const hunk = HUNK.exec(line);
  if (!(hunk && cursor.file)) return;
  cursor.oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
  cursor.next = Number(hunk[3]);
  cursor.newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
  cursor.file.hunks.push({ oldStart: Number(hunk[1]), oldCount: cursor.oldLeft, newCount: cursor.newLeft });
}

function parseDiffFiles(diff: string) {
  const files: DiffFileLines[] = [];
  const cursor: DiffCursor = { file: null, oldLeft: 0, newLeft: 0, next: 0 };
  for (const raw of diff.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (cursor.oldLeft > 0 || cursor.newLeft > 0) readHunkLine(cursor, line);
    else readHeaderLine(cursor, line, files);
  }
  return files;
}

export function parseChangedLines(diff: string): ChangedLines {
  const changed: ChangedLines = new Map();
  for (const file of parseDiffFiles(diff)) {
    if (!file.path || file.added.length === 0) continue;
    changed.set(file.path, [...(changed.get(file.path) ?? []), ...file.added]);
  }
  return changed;
}
