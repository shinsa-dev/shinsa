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

interface ReviewChoice {
  verdicts: Record<number, FindingVerdictKind>;
  thenApprove: boolean;
}

const NO_CHOICE: ReviewChoice = { verdicts: {}, thenApprove: false };

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
  const [chosen, setChosen] = React.useState<ReviewChoice & { key: string }>(() => ({
    key: draftKey,
    ...NO_CHOICE,
  }));
  const comments = draft.key === draftKey ? draft.comments : readStoredComments(draftKey);
  const { verdicts, thenApprove } = chosen.key === draftKey ? chosen : NO_CHOICE;
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
        setChosen((previous) => {
          const kept = previous.key === draftKey ? previous : NO_CHOICE;
          return { ...kept, key: draftKey, verdicts: { ...kept.verdicts, [index]: verdict } };
        }),
      thenApprove,
      chooseThenApprove: (next) =>
        setChosen((previous) => ({
          ...(previous.key === draftKey ? previous : NO_CHOICE),
          key: draftKey,
          thenApprove: next,
        })),
    };
  }, [enabled, comments, verdicts, thenApprove, draftKey]);
  return <ReviewDraftContext.Provider value={value}>{children}</ReviewDraftContext.Provider>;
}
