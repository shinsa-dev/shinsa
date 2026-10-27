import type { ChatAttachment } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { resolveFileIcon } from '@/lib/code/file-icons.ts';
import { formatBytes } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';

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

const EXTENSION_TONES: [Tone, readonly string[]][] = [
  ['red', ['pdf']],
  ['green', ['csv', 'tsv', 'xls', 'xlsx', 'ods', 'numbers']],
  ['orange', ['ppt', 'pptx', 'odp', 'key']],
  ['amber', ['zip', 'tar', 'gz', 'tgz', '7z', 'rar', 'bz2', 'xz', 'dmg', 'pkg']],
  [
    'purple',
    ['mp4', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'svg', 'fig', 'sketch'],
  ],
  [
    'blue',
    [
      'doc',
      'docx',
      'odt',
      'rtf',
      'pages',
      'ts',
      'tsx',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'json',
      'py',
      'go',
      'rs',
      'swift',
      'java',
      'kt',
      'php',
      'c',
      'h',
      'cpp',
      'rb',
      'sh',
      'css',
      'html',
      'vue',
      'svelte',
      'sql',
      'yaml',
      'yml',
      'toml',
      'xml',
    ],
  ],
];

const MIME_TONES: [Tone, RegExp][] = [
  ['red', /^application\/pdf$/],
  ['purple', /^(video|audio)\//],
  ['amber', /^application\/(zip|gzip|x-tar|x-7z-compressed|x-rar-compressed)$/],
];

function isBrowserUrl(path: string) {
  return /^(https?:|data:|blob:|\/api\/)/.test(path);
}

function resolveExtension(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function splitAttachments(attachments: ChatAttachment[]) {
  const images = attachments.filter(
    (attachment) => attachment.kind === 'image' && isBrowserUrl(attachment.url)
  );
  return { images, files: attachments.filter((attachment) => !images.includes(attachment)) };
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

export function resolveFileLook(file: FileFacts): { icon: IconName; tone: Tone } {
  const extension = resolveExtension(file.name);
  const icon = (extension ? OFFICE_ICONS[extension] : undefined) ?? resolveFileIcon(file.name);
  const byExtension = extension
    ? EXTENSION_TONES.find(([, extensions]) => extensions.includes(extension))?.[0]
    : undefined;
  const byMime = MIME_TONES.find(([, pattern]) => pattern.test(file.mimeType ?? ''))?.[0];
  return { icon, tone: byExtension ?? byMime ?? 'neutral' };
}

export function describeAttachment(attachment: Pick<ChatAttachment, 'name' | 'mimeType' | 'size'>) {
  const size = attachment.size === null ? null : formatBytes(attachment.size);
  return [resolveFileType(attachment), size].filter(Boolean).join(' · ');
}
