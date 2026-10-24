import { describe, expect, it } from 'bun:test';
import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { useReviewDraft } from '@/hooks/use-review-draft.ts';
import { type ReviewDraft, ReviewDraftContext } from '@/lib/review/draft.ts';

describe('useReviewDraft', () => {
  it('is switched off with no comments outside a review', () => {
    const { result } = renderHook(() => useReviewDraft());
    expect(result.current.enabled).toBe(false);
    expect(result.current.comments).toEqual([]);
    result.current.addComment({ path: 'a.ts', line: 1, text: 'Ignored' });
    result.current.removeComment('1');
    result.current.clearComments();
    expect(result.current.comments).toEqual([]);
  });

  it('hands out the draft of the review around it', () => {
    const draft: ReviewDraft = {
      enabled: true,
      comments: [{ id: '1', path: 'a.ts', line: 4, text: 'Check this.' }],
      addComment: () => undefined,
      removeComment: () => undefined,
      clearComments: () => undefined,
    };
    const { result } = renderHook(() => useReviewDraft(), {
      wrapper: ({ children }) => React.createElement(ReviewDraftContext.Provider, { value: draft }, children),
    });
    expect(result.current).toBe(draft);
  });
});
