import type { ShinsaState, Task } from '@shinsa/core';
import { listEvidencePrefetch, resolveEvidenceLayout } from '@/lib/evidence/layout.ts';
import { requestEvidenceText } from '@/lib/evidence/texts.ts';
import { createCache } from '@/lib/format/cache.ts';

export const EVIDENCE_IMAGE_LIMIT = 64;

const warmed = createCache<HTMLImageElement>(EVIDENCE_IMAGE_LIMIT);

function warmImage(src: string) {
  warmed.read(src, () => {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    return image;
  });
}

export function prefetchEvidence(state: Pick<ShinsaState, 'evidence' | 'runs'>, task: Task) {
  const { images, texts } = listEvidencePrefetch(resolveEvidenceLayout(state, task));
  for (const src of images) warmImage(src);
  for (const uri of texts) void requestEvidenceText(uri);
}
