import type { ReviewComment } from '@shinsa/core';
import * as React from 'react';

export interface LineComment extends ReviewComment {
  id: string;
  ref: string | null;
}

export type DraftComment = Omit<LineComment, 'id' | 'side' | 'endLine' | 'ref'> &
  Partial<Pick<LineComment, 'side' | 'endLine' | 'ref'>>;

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
  };
}

function isComment(value: unknown): value is LineComment {
  const comment = value as Partial<LineComment> | null;
  return (
    typeof comment?.id === 'string' &&
    typeof comment.path === 'string' &&
    typeof comment.line === 'number' &&
    typeof comment.text === 'string'
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
  if (comment.side === 'new') {
    return `${comment.path}:${comment.endLine ? `${comment.line}-${comment.endLine}` : comment.line}`;
  }
  const lines = comment.endLine ? `lines ${comment.line}-${comment.endLine}` : `line ${comment.line}`;
  return `${comment.path}, removed ${lines}`;
}

export function describeCommentLines(comment: Pick<LineComment, 'side' | 'line' | 'endLine'>) {
  const lines = comment.endLine ? `lines ${comment.line}–${comment.endLine}` : `line ${comment.line}`;
  return comment.side === 'old' ? `Removed ${lines}` : `${lines.charAt(0).toUpperCase()}${lines.slice(1)}`;
}

export function serializeComments(comments: readonly LineComment[]): ReviewComment[] {
  return comments.map(({ path, side, line, endLine, text }) => ({ path, side, line, endLine, text }));
}
