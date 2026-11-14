import { Option } from 'effect';
import type { MatchRange, SearchField, TextMatch } from '@/lib/command/search/schema.ts';

export const LABEL_WEIGHT = 1;

export const KEYWORD_WEIGHT = 0.7;

const EXACT_SCORE = 1;

const SPAN_SCORES = {
  prefix: { partial: 0.9, whole: 0.95 },
  wordPrefix: { partial: 0.8, whole: 0.85 },
  substring: { partial: 0.6, whole: 0.65 },
};

const FUZZY_FLOOR = 0.2;

const FUZZY_RANGE = 0.3;

const WORD_START_POINTS = 1;

const RUN_POINTS = 0.75;

const LOOSE_POINTS = 0.25;

const SEPARATORS = new Set([' ', '\t', '\n', '/', '.', '_', ':', '#', '-', '(', ')', '[', ']', ',', '@']);

function isDigit(char: string | undefined) {
  return char !== undefined && char >= '0' && char <= '9';
}

function isWordStart(text: string, index: number) {
  if (index === 0) return true;
  const previous = text[index - 1] as string;
  if (SEPARATORS.has(previous)) return true;
  return isDigit(text[index]) !== isDigit(previous) && !SEPARATORS.has(text[index] as string);
}

export function parseQueryWords(query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function createSearchField(text: string, weight: number, fuzzy: boolean): SearchField {
  return { text, lowered: text.toLowerCase(), weight, fuzzy };
}

function rangeOf(start: number, length: number): MatchRange[] {
  return [{ start, end: start + length }];
}

function findWordPrefix(lowered: string, word: string) {
  let index = lowered.indexOf(word, 1);
  while (index !== -1) {
    if (isWordStart(lowered, index)) return index;
    index = lowered.indexOf(word, index + 1);
  }
  return -1;
}

function listRanges(positions: number[]): MatchRange[] {
  const ranges: MatchRange[] = [];
  for (const position of positions) {
    const last = ranges.at(-1);
    if (last && last.end === position) last.end = position + 1;
    else ranges.push({ start: position, end: position + 1 });
  }
  return ranges;
}

function hasSeparator(lowered: string, from: number, to: number) {
  for (let at = from; at < to; at += 1) if (SEPARATORS.has(lowered[at] as string)) return true;
  return false;
}

function walkFrom(lowered: string, word: string, start: number) {
  const positions = [start];
  let points = WORD_START_POINTS;
  let words = 1;
  let loose = 0;
  for (let at = 1; at < word.length; at += 1) {
    const char = word[at] as string;
    const previous = positions[at - 1] as number;
    let next = -1;
    if (lowered[previous + 1] === char) next = previous + 1;
    else {
      let candidate = lowered.indexOf(char, previous + 1);
      const first = candidate;
      while (candidate !== -1 && !isWordStart(lowered, candidate))
        candidate = lowered.indexOf(char, candidate + 1);
      next = candidate === -1 ? first : candidate;
    }
    if (next === -1) return Option.none();
    if (next === previous + 1) points += RUN_POINTS;
    else if (isWordStart(lowered, next)) {
      points += WORD_START_POINTS;
      words += 1;
    } else {
      if (hasSeparator(lowered, previous + 1, next)) return Option.none();
      points += LOOSE_POINTS;
      loose += 1;
    }
    positions.push(next);
  }
  if (words === 1 && loose * 2 > word.length) return Option.none();
  const span = (positions.at(-1) as number) - start + 1;
  const quality = (points / word.length) * (word.length / span) ** 0.25;
  return Option.some({
    score: FUZZY_FLOOR + FUZZY_RANGE * Math.min(quality, 1),
    ranges: listRanges(positions),
  });
}

function selectFuzzyMatch(lowered: string, word: string): Option.Option<TextMatch> {
  const first = word[0] as string;
  let best: Option.Option<TextMatch> = Option.none();
  let start = lowered.indexOf(first);
  while (start !== -1) {
    if (isWordStart(lowered, start)) {
      const match = walkFrom(lowered, word, start);
      if (Option.isSome(match) && (Option.isNone(best) || match.value.score > best.value.score)) best = match;
    }
    start = lowered.indexOf(first, start + 1);
  }
  return best;
}

function endsWord(lowered: string, end: number) {
  return end === lowered.length || SEPARATORS.has(lowered[end] as string);
}

function scoreSpan(lowered: string, start: number, length: number, kind: keyof typeof SPAN_SCORES) {
  const scores = SPAN_SCORES[kind];
  const score = endsWord(lowered, start + length) ? scores.whole : scores.partial;
  return Option.some({ score, ranges: rangeOf(start, length) });
}

export function selectWordMatch(field: SearchField, word: string): Option.Option<TextMatch> {
  const { lowered } = field;
  if (lowered === word) return Option.some({ score: EXACT_SCORE, ranges: rangeOf(0, word.length) });
  if (lowered.startsWith(word)) return scoreSpan(lowered, 0, word.length, 'prefix');
  const wordPrefix = findWordPrefix(lowered, word);
  if (wordPrefix !== -1) return scoreSpan(lowered, wordPrefix, word.length, 'wordPrefix');
  const inside = lowered.indexOf(word);
  if (inside !== -1) return scoreSpan(lowered, inside, word.length, 'substring');
  if (!field.fuzzy || word.length < 2) return Option.none();
  return selectFuzzyMatch(lowered, word);
}

function scoreWord(fields: SearchField[], word: string) {
  let best = 0;
  for (const field of fields) {
    if (field.weight <= best) continue;
    const match = selectWordMatch(field, word);
    if (Option.isSome(match)) best = Math.max(best, match.value.score * field.weight);
  }
  return best;
}

export function scoreFields(fields: SearchField[], words: string[]) {
  if (words.length === 0) return 1;
  let total = 0;
  for (const word of words) {
    const best = scoreWord(fields, word);
    if (best === 0) return 0;
    total += best;
  }
  return total / words.length;
}

export function listKeywordFields([label = '', ...rest]: string[]) {
  return [
    createSearchField(label, LABEL_WEIGHT, true),
    ...rest.filter(Boolean).map((keyword) => createSearchField(keyword, KEYWORD_WEIGHT, false)),
  ];
}

export function scoreKeywords(keywords: string[], query: string) {
  return scoreFields(listKeywordFields(keywords), parseQueryWords(query));
}

export function listMatchRanges(text: string, query: string): MatchRange[] {
  const field = createSearchField(text, LABEL_WEIGHT, true);
  const positions = new Set<number>();
  for (const word of parseQueryWords(query)) {
    const match = selectWordMatch(field, word);
    if (Option.isNone(match)) continue;
    for (const range of match.value.ranges)
      for (let at = range.start; at < range.end; at += 1) positions.add(at);
  }
  return listRanges([...positions].sort((a, b) => a - b));
}
