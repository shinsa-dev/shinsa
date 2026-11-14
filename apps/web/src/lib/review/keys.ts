import { isTyping } from '@/lib/keys.ts';

export type ReviewStep = 1 | -1;

interface ReviewKeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
}

export const REVIEW_KEY: Record<'next' | 'previous', string> = { next: 'J', previous: 'K' };

export function resolveReviewKey(event: ReviewKeyPress): ReviewStep | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTyping(event.target)) {
    return null;
  }
  if (event.key === 'j') return 1;
  if (event.key === 'k') return -1;
  return null;
}
