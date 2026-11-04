import { DateTime, Option } from 'effect';
import { parseRange } from '../bytes.ts';
import type { DownloadPointer } from '../releases/schema.ts';
import { DMG_HEADERS, type Validators } from './schema.ts';

function listEntityTags(header: string) {
  return header.split(',').map((tag) => tag.trim());
}

function matchesStrong(header: string, etag: string) {
  return listEntityTags(header).some((tag) => tag === '*' || tag === etag);
}

function matchesWeak(header: string, etag: string) {
  return listEntityTags(header).some((tag) => tag === '*' || tag.replace(/^W\//, '') === etag);
}

function parseSeconds(header: string | null) {
  if (header === null) return null;
  return Option.match(DateTime.make(header), {
    onNone: () => null,
    onSome: (time) => Math.floor(DateTime.toEpochMillis(time) / 1000),
  });
}

function matchesIfRange(header: string | null, validators: Validators) {
  if (header === null) return true;
  if (header.startsWith('"') || header.startsWith('W/')) return header === validators.etag;
  return parseSeconds(header) === validators.modifiedSeconds;
}

export function resolveValidators(pointer: DownloadPointer): Validators {
  const modified = DateTime.makeUnsafe(pointer.publishedAt);
  return {
    etag: `"${pointer.sha256}"`,
    lastModified: DateTime.toDateUtc(modified).toUTCString(),
    modifiedSeconds: Math.floor(DateTime.toEpochMillis(modified) / 1000),
  };
}

export function resolvePrecondition(headers: Headers, validators: Validators): 304 | 412 | null {
  const ifMatch = headers.get('if-match');
  const unmodifiedSince = parseSeconds(headers.get('if-unmodified-since'));
  if (ifMatch !== null && !matchesStrong(ifMatch, validators.etag)) return 412;
  if (ifMatch === null && unmodifiedSince !== null && validators.modifiedSeconds > unmodifiedSince)
    return 412;
  const ifNoneMatch = headers.get('if-none-match');
  if (ifNoneMatch !== null) return matchesWeak(ifNoneMatch, validators.etag) ? 304 : null;
  const modifiedSince = parseSeconds(headers.get('if-modified-since'));
  if (modifiedSince !== null && validators.modifiedSeconds <= modifiedSince) return 304;
  return null;
}

export function resolveRequestedRange(request: Request, pointer: DownloadPointer, validators: Validators) {
  const header = request.headers.get('range');
  if (request.method === 'HEAD' || header === null) return null;
  if (!matchesIfRange(request.headers.get('if-range'), validators)) return null;
  return parseRange(header, pointer.size);
}

export function createDmgHeaders(pointer: DownloadPointer, validators: Validators) {
  return new Headers({
    ...DMG_HEADERS,
    'Content-Disposition': `attachment; filename="Shinsa-${pointer.version}.dmg"`,
    ETag: validators.etag,
    'Last-Modified': validators.lastModified,
  });
}
