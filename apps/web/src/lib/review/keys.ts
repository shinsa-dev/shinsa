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

function isTyping(target: EventTarget | null) {
  const element = target as Partial<HTMLElement> | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return element.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

export function resolveReviewKey(event: ReviewKeyPress): ReviewStep | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isTyping(event.target)) {
    return null;
  }
  if (event.key === 'j') return 1;
  if (event.key === 'k') return -1;
  return null;
}
