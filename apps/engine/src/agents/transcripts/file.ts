import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export function readRange(path: string, from: number, to: number) {
  const bytes = Buffer.alloc(to - from);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, bytes, 0, bytes.length, from);
  } finally {
    closeSync(handle);
  }
  return bytes;
}

export function readSize(path: string) {
  return existsSync(path) ? statSync(path).size : -1;
}
