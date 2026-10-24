type RowKind = 'add' | 'remove' | 'context';

export interface CodeRow {
  kind: RowKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  lines: { kind: RowKind; text: string }[];
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const raw of patch.replace(/\n$/, '').split('\n')) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      current = { oldStart: Number(header[1]), newStart: Number(header[2]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) current.lines.push({ kind: 'add', text: raw.slice(1) });
    else if (raw.startsWith('-')) current.lines.push({ kind: 'remove', text: raw.slice(1) });
    else if (raw.startsWith(' ') || raw === '') current.lines.push({ kind: 'context', text: raw.slice(1) });
  }
  return hunks;
}

function trimTrailingEmpty(lines: string[]) {
  return lines.length > 0 && lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}

export function resolveCodeRows(patch: string, content: string | null): CodeRow[] {
  const hunks = parseHunks(patch);
  const fileLines = content === null ? null : trimTrailingEmpty(content.split('\n'));
  const rows: CodeRow[] = [];
  let newLine = 1;
  let oldLine = 1;

  function pushUnchangedUntil(nextNew: number) {
    if (!fileLines) {
      oldLine += nextNew - newLine;
      newLine = nextNew;
      return;
    }
    while (newLine < nextNew && newLine <= fileLines.length) {
      rows.push({ kind: 'context', text: fileLines[newLine - 1] ?? '', oldLine, newLine });
      newLine += 1;
      oldLine += 1;
    }
  }

  for (const hunk of hunks) {
    pushUnchangedUntil(Math.max(hunk.newStart, 1));
    oldLine = hunk.oldStart || 1;
    newLine = hunk.newStart || 1;
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        rows.push({ kind: 'add', text: line.text, oldLine: null, newLine });
        newLine += 1;
      } else if (line.kind === 'remove') {
        rows.push({ kind: 'remove', text: line.text, oldLine, newLine: null });
        oldLine += 1;
      } else {
        rows.push({ kind: 'context', text: line.text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  if (fileLines) pushUnchangedUntil(fileLines.length + 1);
  return rows;
}

export function resolveRowAnchor(row: CodeRow) {
  return row.newLine ?? row.oldLine ?? 0;
}

export function findRowIndex(rows: CodeRow[], line: number) {
  const exact = rows.findIndex((row) => row.newLine === line);
  if (exact >= 0) return exact;
  const after = rows.findIndex((row) => row.newLine !== null && row.newLine > line);
  return after >= 0 ? after : Math.max(rows.length - 1, 0);
}

interface RowSegment {
  kind: 'rows' | 'gap';
  start: number;
  end: number;
}

const MIN_HIDDEN_ROWS = 5;

function listKeptRows(rows: CodeRow[], context: number) {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (const [rowIndex, row] of rows.entries()) {
    if (row.kind === 'context') continue;
    const first = Math.max(0, rowIndex - context);
    const last = Math.min(rows.length - 1, rowIndex + context);
    for (let target = first; target <= last; target += 1) keep[target] = true;
  }
  return keep;
}

export function resolveSegments(
  rows: CodeRow[],
  context: number,
  expanded: ReadonlySet<number>
): RowSegment[] {
  const keep = listKeptRows(rows, context);
  const segments: RowSegment[] = [];
  let index = 0;
  while (index < rows.length) {
    const start = index;
    const kept = keep[index] === true;
    while (index < rows.length && keep[index] === kept) index += 1;
    if (!kept && !expanded.has(start) && index - start >= MIN_HIDDEN_ROWS) {
      segments.push({ kind: 'gap', start, end: index });
      continue;
    }
    const last = segments.at(-1);
    if (last?.kind === 'rows' && last.end === start) last.end = index;
    else segments.push({ kind: 'rows', start, end: index });
  }
  return segments;
}
