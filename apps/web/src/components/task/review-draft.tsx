import * as React from 'react';
import { type LineComment, type ReviewDraft, ReviewDraftContext } from '@/lib/review/draft.ts';

const NO_COMMENTS: LineComment[] = [];

export function ReviewDraftProvider({
  enabled,
  draftKey,
  children,
}: {
  enabled: boolean;
  draftKey: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState<{ key: string; comments: LineComment[] }>({
    key: draftKey,
    comments: [],
  });
  const comments = draft.key === draftKey ? draft.comments : NO_COMMENTS;
  const value = React.useMemo<ReviewDraft>(() => {
    const update = (change: (current: LineComment[]) => LineComment[]) =>
      setDraft((current) => ({
        key: draftKey,
        comments: change(current.key === draftKey ? current.comments : NO_COMMENTS),
      }));
    return {
      enabled,
      comments,
      addComment: (comment) => update((current) => [...current, { ...comment, id: crypto.randomUUID() }]),
      removeComment: (id) => update((current) => current.filter((comment) => comment.id !== id)),
      clearComments: () => update(() => NO_COMMENTS),
    };
  }, [enabled, comments, draftKey]);
  return <ReviewDraftContext.Provider value={value}>{children}</ReviewDraftContext.Provider>;
}
