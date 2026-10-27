import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const EVIDENCE_ROUTE = '/api/evidence/';

export const EVIDENCE_COPY_LIMIT_BYTES = 200 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;

const ROUND_SEGMENT = /^round-\d+$/;

const SLUG_LIMIT = 48;

const NAME_ID_LENGTH = 12;

const MEGABYTE = 1024 * 1024;

const TEXT_READ_LIMIT_BYTES = MEGABYTE;

export interface EvidenceFolder {
  taskId: string;
  round: number;
}

function resolveExtension(text: string, fallback: string) {
  const extension = text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return extension || fallback;
}

function resolveSlug(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '');
  return slug || 'evidence';
}

export function resolveEvidenceFolder({ taskId, round }: EvidenceFolder) {
  if (!SEGMENT.test(taskId)) throw new Error(`${taskId} cannot name an evidence folder.`);
  return `${taskId}/round-${round}`;
}

function isEvidencePath(segments: string[]) {
  if (!segments.every((segment) => SEGMENT.test(segment))) return false;
  return segments.length === 1 || (segments.length === 3 && ROUND_SEGMENT.test(segments[1] ?? ''));
}

export class EvidenceStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #write(folder: string | null, base: string, extension: string, write: (path: string) => void) {
    const id = Bun.randomUUIDv7().replace(/-/g, '').slice(-NAME_ID_LENGTH);
    const name = `${base}${id}.${extension}`;
    const relative = folder ? `${folder}/${name}` : name;
    if (folder) mkdirSync(join(this.#dir, folder), { recursive: true });
    write(join(this.#dir, relative));
    return `${EVIDENCE_ROUTE}${relative}`;
  }

  writeImage(base64: string, mediaType: string) {
    const extension = resolveExtension(mediaType.split('/')[1] ?? '', 'png');
    return this.#write(null, '', extension, (path) => writeFileSync(path, Buffer.from(base64, 'base64')));
  }

  writeText(text: string, folder: EvidenceFolder, title: string, extension: 'txt' | 'md' = 'txt') {
    return this.#write(resolveEvidenceFolder(folder), `${resolveSlug(title)}-`, extension, (path) =>
      writeFileSync(path, text)
    );
  }

  copyFile(source: string, folder: EvidenceFolder, title: string) {
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`No file at ${source}.`);
    const { size } = statSync(source);
    if (size > EVIDENCE_COPY_LIMIT_BYTES) {
      throw new Error(
        `${source} is ${Math.ceil(size / MEGABYTE)} MB; the limit is ${EVIDENCE_COPY_LIMIT_BYTES / MEGABYTE} MB. Record a shorter clip or a smaller window.`
      );
    }
    const extension = resolveExtension(extname(source), 'bin');
    return this.#write(resolveEvidenceFolder(folder), `${resolveSlug(title)}-`, extension, (path) =>
      copyFileSync(source, path)
    );
  }

  selectFile(name: string) {
    const segments = name.split('/');
    if (!isEvidencePath(segments)) return null;
    const path = join(this.#dir, ...segments);
    return existsSync(path) && statSync(path).isFile() ? path : null;
  }

  selectText(uri: string) {
    if (!uri.startsWith(EVIDENCE_ROUTE)) return null;
    const path = this.selectFile(uri.slice(EVIDENCE_ROUTE.length));
    if (!path || statSync(path).size > TEXT_READ_LIMIT_BYTES) return null;
    return readFileSync(path, 'utf8');
  }
}
