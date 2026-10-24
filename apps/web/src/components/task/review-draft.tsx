import * as React from 'react';
import {
  createLineComment,
  type LineComment,
  type ReviewDraft,
  ReviewDraftContext,
  readStoredComments,
  writeStoredComments,
} from '@/lib/review/draft.ts';

export function ReviewDraftProvider({
  enabled,
  draftKey,
  children,
}: {
  enabled: boolean;
  draftKey: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState<{ key: string; comments: LineComment[] }>(() => ({
    key: draftKey,
    comments: readStoredComments(draftKey),
  }));
  const comments = draft.key === draftKey ? draft.comments : readStoredComments(draftKey);
  const value = React.useMemo<ReviewDraft>(() => {
    const update = (change: (current: LineComment[]) => LineComment[]) =>
      setDraft((current) => {
        const next = change(current.key === draftKey ? current.comments : readStoredComments(draftKey));
        writeStoredComments(draftKey, next);
        return { key: draftKey, comments: next };
      });
    return {
      enabled,
      comments,
      addComment: (comment) =>
        update((current) => [...current, createLineComment(comment, crypto.randomUUID())]),
      removeComment: (id) => update((current) => current.filter((comment) => comment.id !== id)),
      clearComments: () => update(() => []),
    };
  }, [enabled, comments, draftKey]);
  return <ReviewDraftContext.Provider value={value}>{children}</ReviewDraftContext.Provider>;
}
