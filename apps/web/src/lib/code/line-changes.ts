const MAX_CELLS = 400_000;

function splitText(text: string) {
  return text === '' ? [] : text.split('\n');
}

function countCommonLines(before: string[], after: string[]) {
  let previous = new Uint32Array(after.length + 1);
  for (const line of before) {
    const current = new Uint32Array(after.length + 1);
    for (let j = 0; j < after.length; j += 1) {
      current[j + 1] =
        line === after[j] ? (previous[j] ?? 0) + 1 : Math.max(previous[j + 1] ?? 0, current[j] ?? 0);
    }
    previous = current;
  }
  return previous[after.length] ?? 0;
}

export function countLineChanges(beforeText: string, afterText: string) {
  const before = splitText(beforeText);
  const after = splitText(afterText);
  const common = (before.length + 1) * (after.length + 1) > MAX_CELLS ? 0 : countCommonLines(before, after);
  return { added: after.length - common, removed: before.length - common };
}
