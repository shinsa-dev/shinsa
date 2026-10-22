import { copyFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const EVIDENCE_ROUTE = '/api/evidence/';

const EVIDENCE_NAME = /^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/;

function resolveExtension(text: string, fallback: string) {
  const extension = text
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return extension || fallback;
}

export class EvidenceStore {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #write(extension: string, write: (path: string) => void) {
    const name = `${Bun.randomUUIDv7()}.${extension}`;
    write(join(this.#dir, name));
    return `${EVIDENCE_ROUTE}${name}`;
  }

  writeImage(base64: string, mediaType: string) {
    const extension = resolveExtension(mediaType.split('/')[1] ?? '', 'png');
    return this.#write(extension, (path) => writeFileSync(path, Buffer.from(base64, 'base64')));
  }

  writeText(text: string) {
    return this.#write('txt', (path) => writeFileSync(path, text));
  }

  copyFile(source: string) {
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`No file at ${source}.`);
    const extension = resolveExtension(extname(source), 'bin');
    return this.#write(extension, (path) => copyFileSync(source, path));
  }

  selectFile(name: string) {
    if (!EVIDENCE_NAME.test(name)) return null;
    const path = join(this.#dir, name);
    return existsSync(path) ? path : null;
  }
}
