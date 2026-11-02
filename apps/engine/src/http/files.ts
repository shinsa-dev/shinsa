import type { BunFile } from 'bun';
import { HttpServerResponse } from 'effect/http';

const IMMUTABLE = 'private, max-age=31536000, immutable';

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

const INLINE_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

function resolveByteRange(header: string, size: number) {
  const match = BYTE_RANGE.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const [, from = '', to = ''] = match;
  if (from === '') {
    const tail = Math.min(Number(to), size);
    return tail > 0 ? { start: size - tail, end: size - 1 } : null;
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  return start <= end ? { start, end } : null;
}

export function resolveAttachmentHeaders(type: string, fileName: string): Record<string, string> {
  const safety = {
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
  };
  if (INLINE_ATTACHMENT_TYPES.has(type.split(';')[0]?.trim() ?? '')) return safety;
  return { ...safety, 'Content-Disposition': `attachment; filename="${fileName}"` };
}

export function respondFile(file: BunFile, range: string | undefined, extra: Record<string, string> = {}) {
  const headers = {
    'Cache-Control': IMMUTABLE,
    'Accept-Ranges': 'bytes',
    'Content-Type': file.type,
    ...extra,
  };
  if (!range) return HttpServerResponse.raw(file, { headers });
  const size = file.size;
  const bytes = resolveByteRange(range, size);
  if (!bytes)
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${size}` },
    });
  return HttpServerResponse.raw(file.slice(bytes.start, bytes.end + 1), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${bytes.start}-${bytes.end}/${size}`,
      'Content-Length': String(bytes.end - bytes.start + 1),
    },
  });
}
