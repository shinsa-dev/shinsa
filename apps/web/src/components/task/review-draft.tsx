import type { FindingVerdictKind } from '@shinsa/core';
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
  const [chosen, setChosen] = React.useState<{ key: string; verdicts: Record<number, FindingVerdictKind> }>(
    () => ({ key: draftKey, verdicts: {} })
  );
  const comments = draft.key === draftKey ? draft.comments : readStoredComments(draftKey);
  const verdicts = chosen.key === draftKey ? chosen.verdicts : {};
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
      verdicts,
      setVerdict: (index, verdict) =>
        setChosen((current) => ({
          key: draftKey,
          verdicts: { ...(current.key === draftKey ? current.verdicts : {}), [index]: verdict },
        })),
    };
  }, [enabled, comments, verdicts, draftKey]);
  return <ReviewDraftContext.Provider value={value}>{children}</ReviewDraftContext.Provider>;
}
