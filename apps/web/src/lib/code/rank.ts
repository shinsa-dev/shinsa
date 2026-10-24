export interface RankedPath {
  path: string;
  score: number;
  hits: number[];
}

const BOUNDARY = /[/_\-.\s]/;

function isWordStart(path: string, index: number) {
  if (index === 0) return true;
  const before = path[index - 1] ?? '';
  const current = path[index] ?? '';
  if (BOUNDARY.test(before)) return true;
  return before === before.toLowerCase() && current !== current.toLowerCase();
}

function matchFrom(path: string, lower: string, query: string, start: number) {
  const hits: number[] = [];
  let score = 0;
  let cursor = start;
  for (const char of query) {
    const index = lower.indexOf(char, cursor);
    if (index < 0) return null;
    const previous = hits.at(-1);
    score += 1;
    if (previous !== undefined && index === previous + 1) score += 5;
    if (isWordStart(path, index)) score += 8;
    if (previous !== undefined) score -= index - previous - 1;
    hits.push(index);
    cursor = index + 1;
  }
  return { score, hits };
}

function listRange(from: number, length: number) {
  return Array.from({ length }, (_, offset) => from + offset);
}

function matchSubstring(path: string, lower: string, needle: string, nameStart: number) {
  const inName = lower.indexOf(needle, nameStart);
  if (inName >= 0) {
    const start = inName === nameStart ? 30 : isWordStart(path, inName) ? 15 : 0;
    return { score: 100 + start, hits: listRange(inName, needle.length) };
  }
  const anywhere = lower.indexOf(needle);
  if (anywhere < 0) return null;
  return { score: 60 + (isWordStart(path, anywhere) ? 10 : 0), hits: listRange(anywhere, needle.length) };
}

export function scorePath(path: string, query: string): RankedPath | null {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return { path, score: 0, hits: [] };
  const lower = path.toLowerCase();
  const nameStart = path.lastIndexOf('/') + 1;
  const exact = matchSubstring(path, lower, needle, nameStart);
  const inName = exact ? null : matchFrom(path, lower, needle, nameStart);
  const match =
    exact ?? (inName ? { ...inName, score: inName.score + 10 } : matchFrom(path, lower, needle, 0));
  if (!match) return null;
  return { path, score: match.score - path.length * 0.01, hits: match.hits };
}

export function rankPaths(
  paths: readonly string[],
  query: string,
  limit: number,
  recent: readonly string[] = []
) {
  if (!query.trim()) {
    const known = new Set(paths);
    const first = recent.filter((path) => known.has(path));
    const rest = paths.filter((path) => !first.includes(path));
    return [...first, ...rest].slice(0, limit).map((path) => ({ path, score: 0, hits: [] }));
  }
  const ranked: RankedPath[] = [];
  for (const path of paths) {
    const match = scorePath(path, query);
    if (match) ranked.push(match);
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).slice(0, limit);
}

export function splitHits(text: string, hits: readonly number[], offset = 0) {
  const marked = new Set(hits.map((hit) => hit - offset));
  const parts: { text: string; hit: boolean }[] = [];
  for (const [index, char] of [...text].entries()) {
    const hit = marked.has(index);
    const last = parts.at(-1);
    if (last && last.hit === hit) last.text += char;
    else parts.push({ text: char, hit });
  }
  return parts;
}
