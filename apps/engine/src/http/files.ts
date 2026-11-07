import { Effect, FileSystem, Option } from 'effect';
import { HttpServerResponse, Mime } from 'effect/http';

const IMMUTABLE = 'private, max-age=31536000, immutable';

const UNKNOWN_TYPE = 'application/octet-stream';

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

export function resolveFileType(path: string) {
  return Option.getOrElse(Mime.getType(path), () => UNKNOWN_TYPE);
}

export const respondFile = Effect.fn('Http.respondFile')(function* (
  path: string,
  range: string | undefined,
  extra: Record<string, string> = {}
) {
  const fs = yield* FileSystem.FileSystem;
  const headers = {
    'Cache-Control': IMMUTABLE,
    'Accept-Ranges': 'bytes',
    ...extra,
  };
  const contentType = resolveFileType(path);
  if (!range) return yield* HttpServerResponse.file(path, { headers, contentType });
  const size = Number((yield* fs.stat(path)).size);
  const bytes = resolveByteRange(range, size);
  if (!bytes)
    return HttpServerResponse.empty({
      status: 416,
      headers: { ...headers, 'Content-Type': contentType, 'Content-Range': `bytes */${size}` },
    });
  return yield* HttpServerResponse.file(path, {
    status: 206,
    contentType,
    offset: bytes.start,
    bytesToRead: bytes.end - bytes.start + 1,
    headers: { ...headers, 'Content-Range': `bytes ${bytes.start}-${bytes.end}/${size}` },
  });
});
