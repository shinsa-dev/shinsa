import type { ChatAttachment } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import { formatBytes } from '@/lib/format/count.ts';

type FileFacts = Pick<ChatAttachment, 'name' | 'mimeType'>;

const OFFICE_ICONS: Record<string, IconName> = {
  doc: 'IconFileText',
  docx: 'IconFileText',
  odt: 'IconFileText',
  rtf: 'IconFileText',
  pages: 'IconFileText',
  xls: 'IconFileTypeTable',
  xlsx: 'IconFileTypeTable',
  ods: 'IconFileTypeTable',
  numbers: 'IconFileTypeTable',
  ppt: 'IconSlidesWide',
  pptx: 'IconSlidesWide',
  odp: 'IconSlidesWide',
  key: 'IconSlidesWide',
};

const MIME_ICONS: [IconName, RegExp][] = [
  ['IconFileTypePdf', /^application\/pdf$/],
  ['IconFileTypeMedia', /^(video|audio)\//],
  ['IconFileTypeArchive', /^application\/(zip|gzip|x-tar|x-7z-compressed|x-rar-compressed)$/],
];

function isBrowserUrl(path: string) {
  return /^(https?:|data:|blob:|\/api\/)/.test(path);
}

function resolveExtension(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm']);

export function splitAttachments(attachments: ChatAttachment[]) {
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && isBrowserUrl(attachment.url)
  );
  return { images, files: attachments.filter((attachment) => !images.includes(attachment)) };
}

export function canPlayAttachment(attachment: Pick<ChatAttachment, 'name' | 'mimeType' | 'url'>) {
  if (!isBrowserUrl(attachment.url)) return false;
  if (attachment.mimeType?.startsWith('video/')) return true;
  const extension = resolveExtension(attachment.name);
  return extension !== null && VIDEO_EXTENSIONS.has(extension);
}

export function canOpenAttachment(attachment: Pick<ChatAttachment, 'url'>) {
  return isBrowserUrl(attachment.url);
}

export function resolveFileType({ name, mimeType }: FileFacts) {
  const extension = resolveExtension(name);
  if (extension && extension.length <= 5) return extension.toUpperCase();
  const subtype = mimeType?.split('/')[1];
  return subtype && /^[a-z0-9]{1,5}$/i.test(subtype) ? subtype.toUpperCase() : null;
}

export function resolveFileGlyph(file: FileFacts): IconName {
  const extension = resolveExtension(file.name);
  if (extension) return OFFICE_ICONS[extension] ?? resolveFileIcon(file.name);
  return (
    MIME_ICONS.find(([, pattern]) => pattern.test(file.mimeType ?? ''))?.[0] ?? resolveFileIcon(file.name)
  );
}

export function describeAttachment(attachment: Pick<ChatAttachment, 'name' | 'mimeType' | 'size'>) {
  const size = attachment.size === null ? null : formatBytes(attachment.size);
  return [resolveFileType(attachment), size].filter(Boolean).join(' · ');
}
