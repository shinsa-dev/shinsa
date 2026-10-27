import { describe, expect, it } from 'bun:test';
import { resolveReviewItemIdentity } from '@/lib/review/identity.ts';
import { type ReviewItem, toCommentItem, toFindingItem } from '@/lib/review/report.ts';

const FINDING = toFindingItem(
  {
    severity: 'blocking',
    file: 'src/a.ts',
    line: 3,
    end: null,
    title: 'Off by one',
    message: 'The loop skips one.',
  },
  0
);

describe('resolveReviewItemIdentity', () => {
  it('names a point by its kind and what it says, not by its place in the list', () => {
    const first = resolveReviewItemIdentity(FINDING);
    expect(first).toMatch(/^finding-[0-9a-z]+$/);
    expect(resolveReviewItemIdentity({ ...FINDING, key: 'finding:4' })).toBe(first);
    expect(resolveReviewItemIdentity({ ...FINDING, body: 'Another point.' })).not.toBe(first);
  });

  it('calls a section spot a spot, and a point without a place still has one name', () => {
    const spot: ReviewItem = { ...FINDING, key: '0:2', place: null, title: null };
    expect(resolveReviewItemIdentity(spot)).toMatch(/^spot-/);
    expect(resolveReviewItemIdentity({ ...spot, key: 'plain' })).toMatch(/^spot-/);
  });

  it('keeps your comment’s own id', () => {
    const comment = toCommentItem({
      id: 'c1',
      path: 'src/a.ts',
      side: 'new',
      line: 3,
      endLine: null,
      ref: null,
      text: 'Why three?',
    });
    expect(resolveReviewItemIdentity(comment)).toBe('comment-c1');
  });
});
