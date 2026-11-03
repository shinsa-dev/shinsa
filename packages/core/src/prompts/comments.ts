import type { ReviewComment } from '../domain/index.ts';

function describeCommentLines(comment: ReviewComment) {
  const plural = comment.endLine !== null;
  const lines = plural ? `${comment.line}-${comment.endLine}` : String(comment.line);
  return `${comment.side === 'old' ? 'removed ' : ''}${plural ? 'lines' : 'line'} ${lines}`;
}

function describeLineComment(comment: ReviewComment) {
  return `- ${comment.path}, ${describeCommentLines(comment)}: ${comment.text}`;
}

export function describeLineComments(comments: readonly ReviewComment[]) {
  if (comments.length === 0) return [];
  return ['', 'Line comments:', ...comments.map(describeLineComment)];
}

export function resolveCommentedMessage(message: string, comments: readonly ReviewComment[]) {
  if (comments.length === 0) return message;
  return [message || 'The human left line comments on the code.', ...describeLineComments(comments)].join(
    '\n'
  );
}
