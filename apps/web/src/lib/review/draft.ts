import type { FindingVerdictKind, ReviewComment } from '@shinsa/core';
import * as React from 'react';

export interface LineComment extends ReviewComment {
  id: string;
  ref: string | null;
}

export type DraftComment = Omit<LineComment, 'id' | 'side' | 'endLine' | 'ref'> &
  Partial<Pick<LineComment, 'side' | 'endLine' | 'ref'>>;

export interface ReviewDraft {
  enabled: boolean;
  reviewing: boolean;
  withMessages: boolean;
  comments: LineComment[];
  addComment: (comment: DraftComment) => void;
  updateComment: (id: string, text: string) => void;
  removeComment: (id: string) => void;
  clearComments: () => void;
  verdicts: Readonly<Record<number, FindingVerdictKind>>;
  setVerdict: (index: number, verdict: FindingVerdictKind) => void;
  thenApprove: boolean;
  chooseThenApprove: (thenApprove: boolean) => void;
}

function ignore() {}

export const ReviewDraftContext = React.createContext<ReviewDraft>({
  enabled: false,
  reviewing: false,
  withMessages: false,
  comments: [],
  addComment: ignore,
  updateComment: ignore,
  removeComment: ignore,
  clearComments: ignore,
  verdicts: {},
  setVerdict: ignore,
  thenApprove: false,
  chooseThenApprove: ignore,
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

export function replaceCommentText(comments: readonly LineComment[], id: string, text: string) {
  return comments.map((comment) => (comment.id === id ? { ...comment, text } : comment));
}

export function listMessageComments(draft: Pick<ReviewDraft, 'withMessages' | 'comments'>) {
  return draft.withMessages ? draft.comments : [];
}

export function describeCommentPlaceholder(reviewing: boolean) {
  return reviewing
    ? 'What should change here? It goes to the agent with your review.'
    : 'What should change here? It goes to the agent with your next message.';
}

function countComments(count: number) {
  return `${count} ${count === 1 ? 'comment' : 'comments'}`;
}

export function describeCommentCount(count: number) {
  return `${countComments(count)} for the agent`;
}

export function describeCommentsWithMessage(count: number) {
  return `${count === 1 ? '1 line comment goes' : `${count} line comments go`} with this message`;
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
