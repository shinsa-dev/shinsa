import type { StoredAttachment } from '@shinsa/core';
import { ATTACHMENT_COUNT_LIMIT, ATTACHMENT_SIZE_LIMIT } from '@/lib/connection/attachments.ts';

export interface AttachmentDraft {
  key: string;
  name: string;
  kind: 'image' | 'file';
  mimeType: string | null;
  size: number;
  preview: string | null;
  stored: StoredAttachment | null;
}

export function resolveDraftKind(file: Pick<File, 'type'>): AttachmentDraft['kind'] {
  return file.type.startsWith('image/') ? 'image' : 'file';
}

export function resolveAcceptedFiles<T extends Pick<File, 'size'>>(files: T[], attached: number) {
  const fitting = files.filter((file) => file.size > 0 && file.size <= ATTACHMENT_SIZE_LIMIT);
  const room = Math.max(0, ATTACHMENT_COUNT_LIMIT - attached);
  const accepted = fitting.slice(0, room);
  if (fitting.length < files.length) {
    return { accepted, refusal: 'Each file must be 1 byte to 25 MB.' };
  }
  if (accepted.length < fitting.length) {
    return { accepted, refusal: `Attach at most ${ATTACHMENT_COUNT_LIMIT} files.` };
  }
  return { accepted, refusal: null };
}

export function listReadyAttachments(drafts: AttachmentDraft[]) {
  return drafts.flatMap((draft) => (draft.stored ? [draft.stored] : []));
}

export function isUploading(drafts: AttachmentDraft[]) {
  return drafts.some((draft) => draft.stored === null);
}

export function canSendDraft(text: string, drafts: AttachmentDraft[], busy: boolean) {
  if (busy || isUploading(drafts)) return false;
  return text.trim().length > 0 || drafts.length > 0;
}
