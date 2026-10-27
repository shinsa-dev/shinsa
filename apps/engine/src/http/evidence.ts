import type { BunFile } from 'bun';

const IMMUTABLE = 'private, max-age=31536000, immutable';

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/;

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

export function respondEvidenceFile(file: BunFile, range: string | null) {
  const headers = { 'Cache-Control': IMMUTABLE, 'Accept-Ranges': 'bytes', 'Content-Type': file.type };
  if (!range) return new Response(file, { headers });
  const size = file.size;
  const bytes = resolveByteRange(range, size);
  if (!bytes) {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  return new Response(file.slice(bytes.start, bytes.end + 1), {
    status: 206,
    headers: {
      ...headers,
      'Content-Range': `bytes ${bytes.start}-${bytes.end}/${size}`,
      'Content-Length': String(bytes.end - bytes.start + 1),
    },
  });
}
