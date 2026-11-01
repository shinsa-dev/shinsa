export type FeedbackStatus = 'drafting' | 'draft' | 'filing' | 'filed' | 'failed';

export type FeedbackSource = 'human' | 'agent';

export interface FeedbackIssue {
  number: number;
  url: string;
}

export interface Feedback {
  id: string;
  source: FeedbackSource;
  note: string;
  title: string | null;
  body: string | null;
  status: FeedbackStatus;
  failure: string | null;
  issue: FeedbackIssue | null;
  taskId: string | null;
  runId: string | null;
  createdAt: number;
  updatedAt: number;
}

export const FEEDBACK_REPOSITORY = 'shinsa-dev/shinsa';

export const FEEDBACK_LIMITS = {
  note: 4_000,
  title: 120,
  body: 6_000,
  failure: 2_000,
  agentWaiting: 10,
  perTask: 3,
} as const;

export type FeedbackLeakKind = 'email' | 'path' | 'secret' | 'url' | 'private_word';

export interface FeedbackLeak {
  kind: FeedbackLeakKind;
  text: string;
}

const PUBLIC_WORDS: ReadonlySet<string> = new Set(['shinsa', 'shinsa-dev', FEEDBACK_REPOSITORY]);

const MIN_PRIVATE_WORD = 2;

const PUBLIC_HOSTS: ReadonlySet<string> = new Set(['shinsa.dev', 'localhost', '127.0.0.1']);

const PUBLIC_URL_PREFIXES = [`https://github.com/${FEEDBACK_REPOSITORY}`];

const PATTERNS: readonly { kind: FeedbackLeakKind; pattern: RegExp }[] = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: 'path', pattern: /(?:\/Users|\/home|\/root)\/[^\s'"`)\]>]+/g },
  { kind: 'path', pattern: /[A-Za-z]:\\Users\\[^\s'"`)\]>]+/g },
  { kind: 'secret', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'secret', pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g },
  { kind: 'secret', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'secret', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'secret', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'secret', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'secret', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { kind: 'secret', pattern: /\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*[^\s'"`]+/gi },
];

const LONG_RUN = /[A-Za-z0-9+_=-]{32,}/g;

const URL_PATTERN = /\bhttps?:\/\/[^\s'"`)\]>]*[^\s'"`)\]>.,;:!?]/g;

function isOpaque(run: string) {
  return /[0-9]/.test(run) && /[A-Za-z]/.test(run);
}

function isPublicUrl(url: string) {
  if (PUBLIC_URL_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) return true;
  const host =
    url
      .replace(/^https?:\/\//, '')
      .split(/[/:?#]/, 1)[0]
      ?.toLowerCase() ?? '';
  return PUBLIC_HOSTS.has(host);
}

function escapePattern(word: string) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isPrivateWord(word: string) {
  const trimmed = word.trim();
  return trimmed.length >= MIN_PRIVATE_WORD && !PUBLIC_WORDS.has(trimmed.toLowerCase());
}

function resolveWordPattern(words: readonly string[]) {
  const unique = [...new Set(words.map((word) => word.trim()).filter(isPrivateWord))];
  if (unique.length === 0) return null;
  const alternatives = unique.sort((left, right) => right.length - left.length).map(escapePattern);
  return new RegExp(`(?<![A-Za-z0-9_])(?:${alternatives.join('|')})(?![A-Za-z0-9_])`, 'gi');
}

interface Match extends FeedbackLeak {
  index: number;
}

function listMatches(text: string, kind: FeedbackLeakKind, pattern: RegExp, keep = (_: string) => true) {
  const matches: Match[] = [];
  for (const found of text.matchAll(pattern)) {
    if (keep(found[0])) matches.push({ kind, text: found[0], index: found.index });
  }
  return matches;
}

export function listFeedbackLeaks(text: string, privateWords: readonly string[]): FeedbackLeak[] {
  const matches = [
    ...PATTERNS.flatMap(({ kind, pattern }) => listMatches(text, kind, pattern)),
    ...listMatches(text, 'secret', LONG_RUN, isOpaque),
    ...listMatches(text, 'url', URL_PATTERN, (url) => !isPublicUrl(url)),
  ];
  const words = resolveWordPattern(privateWords);
  if (words) matches.push(...listMatches(text, 'private_word', words));
  const seen = new Set<string>();
  const leaks: FeedbackLeak[] = [];
  for (const match of matches.sort((left, right) => left.index - right.index)) {
    const key = match.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    leaks.push({ kind: match.kind, text: match.text });
  }
  return leaks;
}

export function resolveFeedbackText(text: string) {
  return text.trim();
}

export function isFeedbackWaiting(entry: Feedback) {
  return entry.status === 'draft' || entry.status === 'failed';
}

export function isFeedbackFileable(entry: Feedback) {
  return isFeedbackWaiting(entry) && entry.title !== null && entry.body !== null;
}
