import { describeCount, type SearchMatch, type SearchResult } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { Option, Result } from 'effect';

export interface MatchGroup {
  path: string;
  matches: SearchMatch[];
}

export function groupMatches(matches: readonly SearchMatch[]): MatchGroup[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const grouped = groups.get(match.path);
    if (grouped) grouped.push(match);
    else groups.set(match.path, [match]);
  }
  return [...groups].map(([path, grouped]) => ({ path, matches: grouped }));
}

export type ResultRow =
  | { kind: 'file'; group: MatchGroup; open: boolean }
  | { kind: 'match'; match: SearchMatch };

export function listResultRows(groups: readonly MatchGroup[], folded: ReadonlySet<string>): ResultRow[] {
  return groups.flatMap((group): ResultRow[] => {
    const open = !folded.has(group.path);
    const file: ResultRow = { kind: 'file', group, open };
    return open ? [file, ...group.matches.map((match): ResultRow => ({ kind: 'match', match }))] : [file];
  });
}

export function resolveResultKey(row: ResultRow) {
  if (row.kind === 'file') return `f:${row.group.path}`;
  return `m:${row.match.path}:${row.match.line}:${row.match.column}`;
}

export function describeSearchResult(result: SearchResult) {
  if (result.matches.length === 0)
    return result.timedOut ? 'The search took too long and was stopped.' : 'No results.';
  const files = new Set(result.matches.map((match) => match.path)).size;
  const summary = `${describeCount(result.matches.length, 'result', 'results')} in ${describeCount(files, 'file', 'files')}`;
  if (result.timedOut) return `${summary}. The search took too long, so these are the first it found.`;
  if (result.truncated) return `${summary}. There are more; narrow the search to see them.`;
  return `${summary}.`;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchOption {
  key: keyof SearchOptions;
  label: string;
  icon: IconName;
}

export const SEARCH_OPTIONS: SearchOption[] = [
  { key: 'caseSensitive', label: 'Match case', icon: 'IconTitleCase' },
  { key: 'wholeWord', label: 'Match whole word', icon: 'IconWholeWord' },
  { key: 'regex', label: 'Use a regular expression', icon: 'IconRegex' },
];

export interface SearchEmpty {
  title: string;
  description: string;
}

export function describeSearchEmpty(
  search: SearchOptions & { query: string; glob: string },
  result: SearchResult | null
): SearchEmpty | null {
  if (search.query.trim() === '')
    return {
      title: 'Search every file',
      description: 'Find text across this task’s code and jump to its line.',
    };
  if (result === null || result.matches.length > 0 || result.timedOut) return null;
  if (search.glob.trim() !== '')
    return {
      title: 'No results',
      description: `Nothing matches in files like ${search.glob.trim()}. Clear Files to include to search them all.`,
    };
  const on = SEARCH_OPTIONS.filter((option) => search[option.key]).map((option) => option.label);
  if (on.length > 0)
    return { title: 'No results', description: `Try again with ${listAlternatives(on)} turned off.` };
  return { title: 'No results', description: 'Check the spelling, or try fewer words.' };
}

function listAlternatives(labels: string[]) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}`;
}

function createPattern(query: string, options: SearchOptions) {
  const literal = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = options.wholeWord ? `\\b(?:${literal})\\b` : literal;
  return Result.getSuccess(Result.try(() => new RegExp(source, options.caseSensitive ? 'g' : 'gi')));
}

export function splitMatchText(text: string, query: string, options: SearchOptions) {
  const pattern = query ? createPattern(query, options) : Option.none();
  if (Option.isNone(pattern)) return [{ text, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern.value)) {
    if (match[0] === '') break;
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false });
    parts.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts;
}

export function listKeyedParts<Part extends { text: string }>(parts: readonly Part[]) {
  let offset = 0;
  return parts.map((part) => {
    const key = `${offset}`;
    offset += part.text.length;
    return { ...part, key };
  });
}
