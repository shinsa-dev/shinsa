import type { ChatAttachment } from '@shinsa/core';
import { formatBytes } from '@/lib/format/count.ts';

function isBrowserUrl(path: string) {
  return /^(https?:|data:|blob:|\/api\/)/.test(path);
}

export function splitAttachments(attachments: ChatAttachment[]) {
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && isBrowserUrl(attachment.url)
  );
  return { images, files: attachments.filter((attachment) => !images.includes(attachment)) };
}

export function describeAttachment(attachment: ChatAttachment) {
  const kind = attachment.mimeType?.split('/')[1]?.toUpperCase() ?? null;
  const size = attachment.size === null ? null : formatBytes(attachment.size);
  return [kind, size].filter(Boolean).join(' · ');
}
