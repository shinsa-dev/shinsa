export interface LineRange {
  from: number;
  to: number;
}

export const COLLAPSE = { margin: 3, minSize: 4 } as const;

export function listCollapsedRanges(
  total: number,
  visible: readonly LineRange[],
  expanded: ReadonlySet<number>
): LineRange[] {
  const keep = new Array<boolean>(total + 2).fill(false);
  for (const range of visible) {
    const from = Math.max(1, range.from - COLLAPSE.margin);
    const to = Math.min(total, range.to + COLLAPSE.margin);
    for (let line = from; line <= to; line += 1) keep[line] = true;
  }
  const ranges: LineRange[] = [];
  let line = 1;
  while (line <= total) {
    if (keep[line]) {
      line += 1;
      continue;
    }
    const from = line;
    while (line <= total && !keep[line]) line += 1;
    const range = { from, to: line - 1 };
    if (range.to - range.from + 1 >= COLLAPSE.minSize && !expanded.has(range.from)) ranges.push(range);
  }
  return ranges;
}

export function selectRangeAt(ranges: readonly LineRange[], line: number) {
  return ranges.find((range) => range.from <= line && line <= range.to) ?? null;
}
