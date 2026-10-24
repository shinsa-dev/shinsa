import * as React from 'react';
import { describeSuggestionLines, type Suggestion } from '@/lib/code/suggestion.ts';

export type CommentSide = 'old' | 'new';

export interface LineComment {
  id: string;
  path: string;
  side: CommentSide;
  line: number;
  endLine: number | null;
  ref: string | null;
  text: string;
  suggestion: Suggestion | null;
}

export type DraftComment = Omit<LineComment, 'id' | 'side' | 'endLine' | 'ref' | 'suggestion'> &
  Partial<Pick<LineComment, 'side' | 'endLine' | 'ref' | 'suggestion'>>;

export interface ReviewDraft {
  enabled: boolean;
  comments: LineComment[];
  addComment: (comment: DraftComment) => void;
  removeComment: (id: string) => void;
  clearComments: () => void;
}

function ignore() {}

export const ReviewDraftContext = React.createContext<ReviewDraft>({
  enabled: false,
  comments: [],
  addComment: ignore,
  removeComment: ignore,
  clearComments: ignore,
});

const STORAGE_PREFIX = 'shinsa.review-draft.';

export function createLineComment(comment: DraftComment, id: string): LineComment {
  return {
    id,
    path: comment.path,
    side: comment.side ?? 'new',
    line: comment.line,
    endLine: comment.endLine && comment.endLine > comment.line ? comment.endLine : null,
    ref: comment.ref ?? null,
    text: comment.text,
    suggestion: comment.suggestion ?? null,
  };
}

function isComment(value: unknown): value is LineComment {
  const comment = value as Partial<LineComment> | null;
  return (
    typeof comment?.id === 'string' && typeof comment.path === 'string' && typeof comment.line === 'number'
  );
}

export function readStoredComments(key: string): LineComment[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${key}`) ?? '[]');
    return Array.isArray(stored) ? stored.filter(isComment) : [];
  } catch {
    return [];
  }
}

export function writeStoredComments(key: string, comments: LineComment[]) {
  if (comments.length === 0) localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  else localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(comments));
}

export function describeCommentPlace(comment: Pick<LineComment, 'path' | 'side' | 'line' | 'endLine'>) {
  const lines = comment.endLine ? `${comment.line}-${comment.endLine}` : String(comment.line);
  return comment.side === 'old' ? `${comment.path}, removed line ${lines}` : `${comment.path}:${lines}`;
}

export function describeCommentLines(comment: Pick<LineComment, 'side' | 'line' | 'endLine'>) {
  const lines = comment.endLine ? `lines ${comment.line}–${comment.endLine}` : `line ${comment.line}`;
  return comment.side === 'old' ? `Removed ${lines}` : `${lines.charAt(0).toUpperCase()}${lines.slice(1)}`;
}

function serializeComment(comment: LineComment) {
  const head = `- ${describeCommentPlace(comment)}:${comment.text ? ` ${comment.text}` : ''}`;
  if (!comment.suggestion) return head;
  const place = describeSuggestionLines(comment.suggestion);
  return `${head}\n  Suggested change for ${place}, apply it as written unless that breaks something:\n  \`\`\`\n${comment.suggestion.text}\n  \`\`\``;
}

export function serializeComments(comments: LineComment[], note: string) {
  const lines = comments.map(serializeComment);
  return [note, lines.length > 0 ? `Line comments:\n${lines.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
