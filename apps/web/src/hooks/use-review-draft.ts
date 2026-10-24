import * as React from 'react';
import { ReviewDraftContext } from '@/lib/review/draft.ts';

export function useReviewDraft() {
  return React.useContext(ReviewDraftContext);
}
