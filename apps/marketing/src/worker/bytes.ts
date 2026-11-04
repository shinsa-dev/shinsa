import type { ByteRange } from './platform/schema.ts';

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header: string, size: number): ByteRange | 'unsatisfiable' | null {
  const match = RANGE_PATTERN.exec(header.trim());
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    const offset = Math.max(0, size - suffix);
    return { offset, length: size - offset };
  }
  const offset = Number(first);
  if (offset >= size) return 'unsatisfiable';
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

export function answerUnsatisfiable(headers: Headers, size: number) {
  headers.set('Content-Range', `bytes */${size}`);
  return new Response(null, { status: 416, headers });
}

export function answerBytes(
  headers: Headers,
  size: number,
  range: ByteRange | null,
  body: ReadableStream | null
) {
  if (!range) {
    headers.set('Content-Length', String(size));
    return new Response(body, { status: 200, headers });
  }
  headers.set('Content-Length', String(range.length));
  headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
  return new Response(body, { status: 206, headers });
}
