import { AUTOPILOT_WORK_LIMITS } from './schema.ts';

const WORD = /[\p{L}\p{N}]+/gu;

const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'when',
  'then',
  'than',
  'them',
  'they',
  'their',
  'there',
  'what',
  'which',
  'where',
  'while',
  'should',
  'would',
  'could',
  'also',
  'only',
  'just',
  'like',
  'make',
  'want',
  'need',
  'please',
  'can',
  'its',
  'our',
  'your',
  'you',
  'are',
  'was',
  'not',
  'but',
  'all',
  'any',
  'each',
  'some',
  'have',
  'has',
  'had',
  'will',
  'been',
  'being',
  'about',
  'over',
  'onto',
  'out',
]);

function resolveRoot(word: string) {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function resolveWorkTermHash(term: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AUTOPILOT_WORK_LIMITS.termBuckets;
}

export function listWorkTerms(text: string): number[] {
  const { requestCharacters, shortestTerm, terms } = AUTOPILOT_WORK_LIMITS;
  const words = text.slice(0, requestCharacters).toLowerCase().match(WORD) ?? [];
  const buckets: number[] = [];
  for (const word of words) {
    if (word.length < shortestTerm || STOP_WORDS.has(word)) continue;
    const bucket = resolveWorkTermHash(resolveRoot(word));
    if (!buckets.includes(bucket)) buckets.push(bucket);
    if (buckets.length === terms) break;
  }
  return buckets.sort((a, b) => a - b);
}
