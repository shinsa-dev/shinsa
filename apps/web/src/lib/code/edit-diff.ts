export interface DiffRow {
  kind: 'add' | 'remove' | 'context';
  text: string;
  oldIndex: number | null;
  newIndex: number | null;
}

const MAX_CELLS = 400_000;

function buildTable(before: string[], after: string[]) {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  return table;
}

function resolveWholeReplacement(before: string[], after: string[]): DiffRow[] {
  return [
    ...before.map((text, index) => ({ kind: 'remove' as const, text, oldIndex: index, newIndex: null })),
    ...after.map((text, index) => ({ kind: 'add' as const, text, oldIndex: null, newIndex: index })),
  ];
}

export function resolveDiffRows(beforeText: string, afterText: string): DiffRow[] {
  const before = beforeText === '' ? [] : beforeText.split('\n');
  const after = afterText === '' ? [] : afterText.split('\n');
  if ((before.length + 1) * (after.length + 1) > MAX_CELLS) return resolveWholeReplacement(before, after);
  const table = buildTable(before, after);
  const width = after.length + 1;
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ kind: 'context', text: before[i] ?? '', oldIndex: i, newIndex: j });
      i += 1;
      j += 1;
    } else if (
      j < after.length &&
      (i >= before.length || (table[i * width + j + 1] ?? 0) > (table[(i + 1) * width + j] ?? 0))
    ) {
      rows.push({ kind: 'add', text: after[j] ?? '', oldIndex: null, newIndex: j });
      j += 1;
    } else {
      rows.push({ kind: 'remove', text: before[i] ?? '', oldIndex: i, newIndex: null });
      i += 1;
    }
  }
  return rows;
}
