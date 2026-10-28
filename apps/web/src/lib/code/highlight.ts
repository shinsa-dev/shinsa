import * as React from 'react';
import { COMMENT_COLOR, COMMENT_TAGS, type CommentSpan, scanCommentLine } from '@/lib/code/comment-tags.ts';
import { CODE_THEME, resolveFenceGrammar, resolveGrammar } from '@/lib/code/grammar.ts';

export { CODE_THEME };

export interface Token {
  content: string;
  style: React.CSSProperties | undefined;
}

export function resolveLanguage(path: string) {
  return resolveGrammar(path);
}

export function resolveFenceLanguage(fence: string | null) {
  return resolveFenceGrammar(fence);
}

export function isTextDiagram(code: string) {
  return /[\u2500-\u257f]/.test(code);
}

export interface ThemedToken {
  content: string;
  color?: string | undefined;
  fontStyle?: number | undefined;
}

function isPlainComment(token: ThemedToken) {
  return token.color === COMMENT_COLOR && !token.fontStyle;
}

function resolveTokenStyle(token: ThemedToken): React.CSSProperties | undefined {
  return token.color ? { color: token.color } : undefined;
}

function tagLine(tokens: readonly ThemedToken[], plainBlock: boolean, first: boolean) {
  const line = tokens.map((token) => token.content).join('');
  const spans: CommentSpan[] = [];
  let at = 0;
  for (const token of tokens) {
    const last = spans.at(-1);
    const to = at + token.content.length;
    if (isPlainComment(token) && last?.to === at) last.to = to;
    else if (isPlainComment(token)) spans.push({ from: at, to });
    at = to;
  }
  const scan = scanCommentLine(line, spans, plainBlock, first);
  const plain = tokens.map((token) => ({ content: token.content, style: resolveTokenStyle(token) }));
  if (!scan.tagged) return { tokens: plain, plainBlock: scan.plainBlock };
  const tag = COMMENT_TAGS[scan.tagged.tag];
  const kept: Token[] = [];
  let end = 0;
  for (const token of plain) {
    const room = scan.tagged.from - end;
    if (room <= 0) break;
    kept.push(room < token.content.length ? { ...token, content: token.content.slice(0, room) } : token);
    end += token.content.length;
  }
  kept.push({
    content: line.slice(scan.tagged.from),
    style: tag.style,
  });
  return { tokens: kept, plainBlock: scan.plainBlock };
}

export function resolveTaggedTokens(lines: readonly (readonly ThemedToken[])[]): Token[][] {
  let plainBlock = false;
  return lines.map((tokens, index) => {
    const tagged = tagLine(tokens, plainBlock, index === 0);
    plainBlock = tagged.plainBlock;
    return tagged.tokens;
  });
}

interface Highlighted {
  code: string;
  language: string;
  tokens: Token[][] | null;
}

const CACHE_LIMIT = 200;

const MAX_HIGHLIGHTED_CHARACTERS = 400_000;

const IDLE_TIMEOUT_MS = 200;

const cache = new Map<string, Promise<Token[][] | null>>();

const resolved = new Map<string, Token[][] | null>();

async function tokenize(code: string, language: string): Promise<Token[][] | null> {
  const { codeToTokens } = await import('shiki');
  const result = await codeToTokens(code, {
    lang: language as Parameters<typeof codeToTokens>[1]['lang'],
    theme: CODE_THEME,
  });
  return resolveTaggedTokens(result.tokens);
}

function resolveKey(code: string, language: string) {
  return `${language}\u0000${code}`;
}

export function requestTokens(code: string, language: string) {
  const key = resolveKey(code, language);
  const known = cache.get(key);
  if (known) return known;
  const pending = tokenize(code, language)
    .catch(() => null)
    .then((tokens) => {
      if (cache.has(key)) resolved.set(key, tokens);
      return tokens;
    });
  cache.set(key, pending);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value ?? '';
    cache.delete(oldest);
    resolved.delete(oldest);
  }
  return pending;
}

export function resetHighlights() {
  cache.clear();
  resolved.clear();
}

function scheduleIdle(work: () => void) {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(work);
  return () => clearTimeout(timer);
}

export function useTokens(code: string | null, path: string) {
  return useLanguageTokens(code, resolveLanguage(path));
}

export function useLanguageTokens(code: string | null, language: string | null) {
  const [highlighted, setHighlighted] = React.useState<Highlighted | null>(null);
  React.useEffect(() => {
    if (code === null || !language || code.length > MAX_HIGHLIGHTED_CHARACTERS) return;
    if (resolved.has(resolveKey(code, language))) return;
    let alive = true;
    const cancel = scheduleIdle(() => {
      void requestTokens(code, language).then((tokens) => {
        if (alive) setHighlighted({ code, language, tokens });
      });
    });
    return () => {
      alive = false;
      cancel();
    };
  }, [code, language]);
  if (highlighted && highlighted.code === code && highlighted.language === language)
    return highlighted.tokens;
  if (code === null || !language) return null;
  return resolved.get(resolveKey(code, language)) ?? null;
}
