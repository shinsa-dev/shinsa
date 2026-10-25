export type CommentTag = 'alert' | 'query' | 'todo' | 'highlight' | 'strike';

export interface CommentSpan {
  from: number;
  to: number;
}

interface TaggedComment {
  from: number;
  tag: CommentTag;
}

export interface CommentScan {
  tagged: TaggedComment | null;
  plainBlock: boolean;
}

export const COMMENT_CLASS = 'tm-code-comment';

export const COMMENT_COLOR = 'var(--code-comment)';

export interface CommentTagStyle {
  color: string;
  textDecoration?: string;
}

export const COMMENT_TAGS: Record<CommentTag, { className: string; style: CommentTagStyle }> = {
  alert: { className: 'tm-code-comment-alert', style: { color: 'var(--code-comment-alert)' } },
  query: { className: 'tm-code-comment-query', style: { color: 'var(--code-comment-query)' } },
  todo: { className: 'tm-code-comment-todo', style: { color: 'var(--code-comment-todo)' } },
  highlight: { className: 'tm-code-comment-highlight', style: { color: 'var(--code-comment-highlight)' } },
  strike: {
    className: 'tm-code-comment-strike',
    style: { color: 'var(--code-comment-strike)', textDecoration: 'line-through' },
  },
};

const TAG_OF: Record<string, CommentTag> = {
  '!': 'alert',
  '?': 'query',
  todo: 'todo',
  '*': 'highlight',
  '//': 'strike',
};

const TAGS = '(!|\\?|\\/\\/|todo|\\*)';

const LINE_COMMENT_START = /^(?:\/\/|#|--|;|%)/;

const LINE_COMMENT = new RegExp(`^(?:(?:\\/\\/)+|#+|(?:--)+|;+|%+)[ \\t]*${TAGS}+`, 'i');

const BLOCK_LINE = new RegExp(`^${TAGS}[ :]*[^*/]`, 'i');

const DOC_LINE = new RegExp(`^(\\*[ \\t]*)${TAGS}[ :]*[^*/]`, 'i');

const BLOCK_OPENER = /^(?:\/\*|<!--|"""|'''|\{-|\(\*|--\[=*\[|#\||=begin)/;

const PLAIN_OPENER = /^\/\*(?:\s|$)/;

const LEADING_SPACE = /^\s*/;

function resolveTag(match: RegExpExecArray | null, group: number) {
  const value = match?.[group];
  return value ? (TAG_OF[value.toLowerCase()] ?? null) : null;
}

function countLeadingSpace(text: string) {
  return LEADING_SPACE.exec(text)?.[0].length ?? 0;
}

function resolveBlockLine(line: string, start: number, plainBlock: boolean): TaggedComment | null {
  const rest = line.slice(start);
  if (!plainBlock && rest.startsWith('*')) {
    const doc = DOC_LINE.exec(rest);
    const tag = resolveTag(doc, 2);
    return doc && tag ? { from: start + (doc[1]?.length ?? 0), tag } : null;
  }
  const tag = resolveTag(BLOCK_LINE.exec(rest), 1);
  return tag ? { from: start, tag } : null;
}

function resolveLineComment(body: string, start: number, first: boolean): TaggedComment | null {
  if (first && start === 0 && body.startsWith('#!')) return null;
  const tag = resolveTag(LINE_COMMENT.exec(body), 1);
  return tag ? { from: start, tag } : null;
}

export function scanCommentLine(
  line: string,
  spans: readonly CommentSpan[],
  plainBlock: boolean,
  first: boolean
): CommentScan {
  let plain = plainBlock;
  let tagged: TaggedComment | null = null;
  for (const span of spans) {
    const start = span.from + countLeadingSpace(line.slice(span.from, span.to));
    const body = line.slice(start, span.to);
    if (BLOCK_OPENER.test(body)) {
      plain = PLAIN_OPENER.test(body) && !body.includes('*/', 2);
      continue;
    }
    if (!tagged && countLeadingSpace(line) === start && !LINE_COMMENT_START.test(body))
      tagged = resolveBlockLine(line, start, plain);
    else if (!tagged) tagged = resolveLineComment(body, start, first);
    if (body.includes('*/')) plain = false;
  }
  return { tagged, plainBlock: plain };
}
