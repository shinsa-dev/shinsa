import { hashDisclosurePart } from '@/lib/preferences/disclosure.ts';
import type { ReviewItem } from '@/lib/review/report.ts';

function resolveItemKind(key: string) {
  const at = key.indexOf(':');
  return at > 0 && !/^\d/.test(key) ? key.slice(0, at) : 'spot';
}

export function resolveReviewItemIdentity(item: ReviewItem): string {
  if (item.key.startsWith('comment:')) return `comment-${item.key.slice('comment:'.length)}`;
  const place = item.place ? `${item.place.file}:${item.place.start}-${item.place.end}` : '';
  const text = [place, item.title ?? '', item.lead ?? '', item.body].join('\n');
  return `${resolveItemKind(item.key)}-${hashDisclosurePart(text)}`;
}
