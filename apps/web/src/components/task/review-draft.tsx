import type { FindingVerdictKind } from '@shinsa/core';
import * as React from 'react';
import {
  createLineComment,
  type LineComment,
  type ReviewDraft,
  ReviewDraftContext,
  readStoredComments,
  replaceCommentText,
  writeStoredComments,
} from '@/lib/review/draft.ts';

interface ReviewChoice {
  verdicts: Record<number, FindingVerdictKind>;
  thenApprove: boolean;
  thenMerge: boolean;
}

const NO_CHOICE: ReviewChoice = { verdicts: {}, thenApprove: false, thenMerge: false };

export function ReviewDraftProvider({
  enabled,
  reviewing = enabled,
  withMessages = false,
  draftKey,
  choiceKey = draftKey,
  children,
}: {
  enabled: boolean;
  reviewing?: boolean;
  withMessages?: boolean;
  draftKey: string;
  choiceKey?: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = React.useState<{ key: string; comments: LineComment[] }>(() => ({
    key: draftKey,
    comments: readStoredComments(draftKey),
  }));
  const [chosen, setChosen] = React.useState<ReviewChoice & { key: string }>(() => ({
    key: choiceKey,
    ...NO_CHOICE,
  }));
  const comments = draft.key === draftKey ? draft.comments : readStoredComments(draftKey);
  const { verdicts, thenApprove, thenMerge } = chosen.key === choiceKey ? chosen : NO_CHOICE;
  const value = React.useMemo<ReviewDraft>(() => {
    const update = (change: (current: LineComment[]) => LineComment[]) =>
      setDraft((current) => {
        const next = change(current.key === draftKey ? current.comments : readStoredComments(draftKey));
        writeStoredComments(draftKey, next);
        return { key: draftKey, comments: next };
      });
    return {
      enabled,
      reviewing,
      withMessages,
      comments,
      addComment: (comment) =>
        update((current) => [...current, createLineComment(comment, crypto.randomUUID())]),
      updateComment: (id, text) => update((current) => replaceCommentText(current, id, text)),
      removeComment: (id) => update((current) => current.filter((comment) => comment.id !== id)),
      clearComments: () => update(() => []),
      verdicts,
      setVerdict: (index, verdict) =>
        setChosen((previous) => {
          const kept = previous.key === choiceKey ? previous : NO_CHOICE;
          return { ...kept, key: choiceKey, verdicts: { ...kept.verdicts, [index]: verdict } };
        }),
      thenApprove,
      chooseThenApprove: (next) =>
        setChosen((previous) => ({
          ...(previous.key === choiceKey ? previous : NO_CHOICE),
          key: choiceKey,
          thenApprove: next,
        })),
      thenMerge,
      chooseThenMerge: (next) =>
        setChosen((previous) => ({
          ...(previous.key === choiceKey ? previous : NO_CHOICE),
          key: choiceKey,
          thenMerge: next,
        })),
    };
  }, [enabled, reviewing, withMessages, comments, verdicts, thenApprove, thenMerge, draftKey, choiceKey]);
  return <ReviewDraftContext.Provider value={value}>{children}</ReviewDraftContext.Provider>;
}
