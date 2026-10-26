function countEdits(from: string, to: string) {
  const rows = Array.from({ length: from.length + 1 }, (_, index) => [index]);
  const first = rows[0] ?? [];
  for (let column = 1; column <= to.length; column += 1) first[column] = column;
  for (let row = 1; row <= from.length; row += 1) {
    const current = rows[row] ?? [];
    const above = rows[row - 1] ?? [];
    for (let column = 1; column <= to.length; column += 1) {
      const cost = from[row - 1] === to[column - 1] ? 0 : 1;
      let best = Math.min(
        (above[column] ?? 0) + 1,
        (current[column - 1] ?? 0) + 1,
        (above[column - 1] ?? 0) + cost
      );
      if (row > 1 && column > 1 && from[row - 1] === to[column - 2] && from[row - 2] === to[column - 1]) {
        best = Math.min(best, (rows[row - 2]?.[column - 2] ?? 0) + 1);
      }
      current[column] = best;
    }
  }
  return rows[from.length]?.[to.length] ?? 0;
}

function resolveTolerance(word: string) {
  if (word.length <= 3) return 1;
  return word.length <= 6 ? 2 : 3;
}

export function selectClosest(word: string, candidates: readonly string[]) {
  const typed = word.toLowerCase();
  if (!typed) return null;
  const prefixed = candidates
    .filter((candidate) => typed.length >= 3 && candidate.startsWith(typed))
    .sort((a, b) => a.length - b.length);
  const [shortest] = prefixed;
  if (shortest && prefixed.every((candidate) => candidate.startsWith(shortest))) return shortest;
  let best: { candidate: string; edits: number } | null = null;
  for (const candidate of candidates) {
    const edits = countEdits(typed, candidate.toLowerCase());
    if (edits <= resolveTolerance(typed) && (!best || edits < best.edits)) best = { candidate, edits };
  }
  return best?.candidate ?? null;
}
