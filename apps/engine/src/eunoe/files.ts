import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function readFileText(path: string) {
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
}

export function replaceFileText(path: string, text: string, mode: number) {
  const staging = `${path}.writing-${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(staging, text, { mode });
  renameSync(staging, path);
}

export function appendFileLine(path: string, line: string) {
  appendFileSync(path, `${line}\n`);
}
