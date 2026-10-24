import * as React from 'react';

export interface LineComment {
  id: string;
  path: string;
  line: number;
  text: string;
}

export interface ReviewDraft {
  enabled: boolean;
  comments: LineComment[];
  addComment: (comment: Omit<LineComment, 'id'>) => void;
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

export function serializeComments(comments: LineComment[], note: string) {
  const lines = comments.map((comment) => `- ${comment.path}:${comment.line}: ${comment.text}`);
  return [note, lines.length > 0 ? `Line comments:\n${lines.join('\n')}` : ''].filter(Boolean).join('\n\n');
}
