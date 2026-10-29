import type { ChatAttachment } from './protocol.ts';

export interface StoredAttachment extends ChatAttachment {
  path: string;
}

const ATTACHMENT_BLOCK = /<(kanna-attachments|attachments)\b[^>]*>([\s\S]*?)<\/\1>/g;

const ATTACHMENT_TAG = /<attachment\b([^>]*?)\/?>/g;

const ATTRIBUTE = /([\w-]+)="([^"]*)"/g;

const DECODED: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
  '&#39;': "'",
};

const ENCODED: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
};

function decodeEntities(value: string) {
  return value.replace(/&(?:amp|quot|lt|gt|#39);/g, (entity) => DECODED[entity] ?? entity);
}

function encodeAttribute(value: string) {
  return value.replace(/[&"<>]/g, (character) => ENCODED[character] ?? character);
}

function readAttachment(source: string): ChatAttachment | null {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    if (match[1] && match[2] !== undefined) attributes.set(match[1], decodeEntities(match[2]));
  }
  const url = attributes.get('url') ?? attributes.get('path') ?? attributes.get('project_path');
  if (!url) return null;
  const mimeType = attributes.get('mime_type') ?? attributes.get('mime') ?? null;
  const size = Number(attributes.get('size_bytes') ?? attributes.get('size'));
  return {
    kind: attributes.get('kind') === 'image' || mimeType?.startsWith('image/') ? 'image' : 'file',
    name: attributes.get('display_name') ?? attributes.get('name') ?? url.split('/').at(-1) ?? url,
    url,
    mimeType,
    size: Number.isFinite(size) && size > 0 ? size : null,
  };
}

export function splitMessageAttachments(text: string) {
  const attachments: ChatAttachment[] = [];
  const body = text.replace(ATTACHMENT_BLOCK, (_block, _tag, inner: string) => {
    for (const match of inner.matchAll(ATTACHMENT_TAG)) {
      const attachment = readAttachment(match[1] ?? '');
      if (attachment) attachments.push(attachment);
    }
    return '';
  });
  return { text: body.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}

function serializeAttachment(attachment: StoredAttachment) {
  const attributes: [string, string | number | null][] = [
    ['kind', attachment.kind],
    ['display_name', attachment.name],
    ['mime_type', attachment.mimeType],
    ['size_bytes', attachment.size],
    ['path', attachment.path],
    ['url', attachment.url],
  ];
  const serialized = attributes
    .filter((entry): entry is [string, string | number] => entry[1] !== null)
    .map(([name, value]) => `${name}="${encodeAttribute(String(value))}"`);
  return `<attachment ${serialized.join(' ')} />`;
}

export function serializeAttachments(text: string, attachments: StoredAttachment[]) {
  const body = text.trim();
  if (attachments.length === 0) return body;
  const block = ['<attachments>', ...attachments.map(serializeAttachment), '</attachments>'].join('\n');
  return body ? `${body}\n\n${block}` : block;
}
